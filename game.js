// game.js (Web Worker 版本)

document.addEventListener('DOMContentLoaded', () => {

    // --- 核心狀態變數 ---
    let state = new TicTacToeState(); // 本地 state (MCTS 需要)
    let gameOver = false;
    let localPlayerSymbol = null; // 'X' 或 'O'
    let currentRoomId = null;
    let currentAILevel = "none";
    let unsubscribeGameListener = null; 
    
    // *** 1. 初始化 Web Worker ***
    // 這會自動在背景載入 mcts_worker.js
    let mctsWorker = null;
    if (window.Worker) {
        mctsWorker = new Worker('mcts_worker.js');
        // 4. 監聽來自 Worker 的運算結果
        mctsWorker.onmessage = function(e) {
            const move = e.data; // 這就是 AI 算出的 move
            onCellClick_AI(move); // 收到結果後，幫 AI 下棋
        };
        mctsWorker.onerror = function(e) {
            console.error("Worker 發生錯誤:", e.message);
            statusLabel.textContent = "AI 運算錯誤";
        };
    } else {
        console.error("您的瀏覽器不支援 Web Workers！AI 將無法運作。");
        // (可以加入備用方案，例如直接在主執行緒運算)
    }

    const difficultyLevels = {
        "簡單": 50,
        "中等": 500,
        "困難": 2000,
        "超困難": 10000 // 現在我們可以放心設定高迭代，不怕卡住
    };

    // --- 獲取 DOM 元素 ---
    const statusLabel = document.getElementById('status-label');
    const lobbyFrame = document.getElementById('lobby-frame');
    const gameInfoFrame = document.getElementById('game-info-frame');
    const roomIdDisplay = document.getElementById('room-id-display');
    const playerSymbolDisplay = document.getElementById('player-symbol-display');
    const boardFrame = document.getElementById('board-frame');
    const restartButton = document.getElementById('restart-button');
    
    const aiDifficultySelect = document.getElementById('ai-difficulty-select');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');
    const roomIdInput = document.getElementById('room-id-input');

    // ... (在 aiDifficultySelect 中加入 "超困難" 選項) ...
    const option = document.createElement("option");
    option.value = "超困難";
    option.text = "超困難 (10000 iter)";
    aiDifficultySelect.add(option);
    
    const boardButtons = [];

    // --- 初始化 ---
    function initialize() {
        for (let i = 0; i < 9; i++) {
            const button = document.createElement('button');
            button.classList.add('cell');
            button.dataset.index = i;
            button.disabled = true;
            button.addEventListener('click', () => onCellClick(i));
            boardFrame.appendChild(button);
            boardButtons.push(button);
        }
        
        btnCreateRoom.addEventListener('click', createRoom);
        btnJoinRoom.addEventListener('click', joinRoom);
        restartButton.addEventListener('click', leaveRoom);
        
        statusLabel.textContent = "請建立或加入一個房間";
    }

    // --- 1. 建立房間 ---
    async function createRoom() {
        localPlayerSymbol = 'X';
        currentAILevel = aiDifficultySelect.value;
        const roomId = (Math.floor(Math.random() * 90000) + 10000).toString();
        
        const newGameData = {
            board: Array(9).fill(' '),
            playerToMove: 'X',
            players: { 'X': true },
            winner: null,
            playerXAI: currentAILevel,
            playerOAI: "none"
        };

        try {
            await db.collection('games').doc(roomId).set(newGameData);
            statusLabel.textContent = "房間建立成功！等待玩家 O 加入...";
            await subscribeToGame(roomId);
        } catch (error) {
            console.error("建立房間失敗:", error);
            statusLabel.textContent = "錯誤：無法建立房間";
        }
    }

    // --- 2. 加入房間 ---
    async function joinRoom() {
        const roomId = roomIdInput.value.trim();
        if (!roomId) return alert("請輸入房間 ID");

        const roomRef = db.collection('games').doc(roomId);
        
        try {
            const doc = await roomRef.get();
            if (!doc.exists) return alert("錯誤：找不到該房間");

            const gameData = doc.data();
            if (gameData.players.O) return alert("錯誤：此房間已滿");

            localPlayerSymbol = 'O';
            currentAILevel = aiDifficultySelect.value;

            await roomRef.update({
                'players.O': true,
                'playerOAI': currentAILevel
            });
            
            await subscribeToGame(roomId);
        } catch (error) {
            console.error("加入房間失敗:", error);
            statusLabel.textContent = "錯誤：無法加入房間";
        }
    }

    // --- 3. 監聽遊戲 (核心！) ---
    async function subscribeToGame(roomId) {
        currentRoomId = roomId;
        
        lobbyFrame.style.display = 'none';
        gameInfoFrame.style.display = 'block';
        restartButton.style.display = 'block';
        roomIdDisplay.textContent = currentRoomId;
        playerSymbolDisplay.textContent = localPlayerSymbol;

        if (unsubscribeGameListener) unsubscribeGameListener();

        unsubscribeGameListener = db.collection('games').doc(roomId)
            .onSnapshot((doc) => {
                if (!doc.exists) {
                    alert("房主已離開，遊戲結束");
                    leaveRoom();
                    return;
                }
                handleGameUpdate(doc.data());
            }, (error) => {
                console.error("監聽失敗:", error);
                leaveRoom();
            });
    }

    // --- 4. 處理遊戲更新 ---
    function handleGameUpdate(gameData) {
        if (gameOver) return;

        state = new TicTacToeState(gameData.board, gameData.playerToMove);
        updateBoard(gameData.board);

        if (gameData.winner) {
            gameOver = true;
            statusLabel.textContent = "遊戲結束！";
            boardButtons.forEach(btn => btn.disabled = true);
            let message = (gameData.winner === 'draw') ? "🤝 平局！ 🤝" : `🎉 玩家 ${gameData.winner} 獲勝！ 🎉`;
            setTimeout(() => alert(message), 100);
            return;
        }

        const isMyTurn = (gameData.playerToMove === localPlayerSymbol);
        
        if (isMyTurn) {
            if (currentAILevel !== "none") {
                // 是我的回合，且我設定了 AI
                statusLabel.textContent = `AI (${localPlayerSymbol}) 正在思考...`;
                boardButtons.forEach(btn => btn.disabled = true);
                
                // *** 2. 向 Web Worker 發送任務 ***
                triggerAITurn(state, difficultyLevels[currentAILevel]);

            } else {
                // 是我的回合，我是真人
                statusLabel.textContent = "輪到你了！";
            }
        } else {
            // 不是我的回合
            statusLabel.textContent = `等待對手 (${gameData.playerToMove}) 下棋...`;
            boardButtons.forEach(btn => btn.disabled = true);
        }
    }
    
    // --- 5. 真人玩家下棋 ---
    async function onCellClick(index) {
        if (gameOver || state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ' || currentAILevel !== "none") {
            return;
        }
        
        // (真人) 準備並提交移動
        await submitMove(index);
    }
    
    // --- 6. AI 玩家下棋 (觸發) ---
    function triggerAITurn(currentState, iterations) {
        if (gameOver || mctsWorker === null) return;

        // *** 3. 向 Worker 發送訊息 (postMessage) ***
        // 我們不能發送 'state' 物件 (因為它有 class 方法)
        // 只能發送純資料 (board 和 playerToMove)
        mctsWorker.postMessage({
            stateData: {
                board: currentState.board,
                playerToMove: currentState.playerToMove
            },
            iterations: iterations
        });
    }
    
    // AI 版的 onCellClick (當 Worker 回傳結果時被呼叫)
    async function onCellClick_AI(index) {
        if (gameOver || state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ') {
            console.warn("AI 試圖下一個無效的棋步");
            return;
        }
        
        // (AI) 準備並提交移動
        await submitMove(index);
    }

    // --- 7. (新) 統一的提交函式 ---
    async function submitMove(index) {
        if (gameOver) return;

        // 立即禁用所有按鈕，防止重複點擊
        boardButtons.forEach(btn => btn.disabled = true);
        
        const newBoard = [...state.board];
        newBoard[index] = localPlayerSymbol;
        const newPlayerToMove = (localPlayerSymbol === 'X') ? 'O' : 'X';
        
        // 檢查是否遊戲結束
        const tempState = new TicTacToeState(newBoard, newPlayerToMove);
        const winner = tempState.checkWinner();

        try {
            await db.collection('games').doc(currentRoomId).update({
                board: newBoard,
                playerToMove: newPlayerToMove,
                winner: winner
            });
            // 不用做任何事，onSnapshot 會自動處理後續
        } catch (error) {
            console.error("提交移動失敗:", error);
            // 重新啟用按鈕 (如果還是我的回合)
            handleGameUpdate(state);
        }
    }

    // --- 輔助函式 ---
    function updateBoard(board) {
        const isMyTurn = (state.playerToMove === localPlayerSymbol);
        
        for (let i = 0; i < 9; i++) {
            boardButtons[i].textContent = board[i];
            
            if (gameOver || state.winner) {
                boardButtons[i].disabled = true;
            } else if (isMyTurn && currentAILevel === "none" && board[i] === ' ') {
                boardButtons[i].disabled = false;
            } else {
                boardButtons[i].disabled = true;
            }
        }
    }

    function leaveRoom() {
        if (unsubscribeGameListener) {
            unsubscribeGameListener();
            unsubscribeGameListener = null;
        }
        
        if (localPlayerSymbol === 'X' && currentRoomId) {
             db.collection('games').doc(currentRoomId).delete().catch(() => {});
        }

        state = new TicTacToeState();
        gameOver = false;
        localPlayerSymbol = null;
        currentRoomId = null;
        
        lobbyFrame.style.display = 'flex';
        gameInfoFrame.style.display = 'none';
        restartButton.style.display = 'none';
        statusLabel.textContent = "請建立或加入一個房間";
        
        boardButtons.forEach(btn => {
            btn.textContent = ' ';
            btn.disabled = true;
        });
        
        roomIdInput.value = "";
    }

    // 啟動應用程式
    initialize();
});