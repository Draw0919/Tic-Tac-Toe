// game.js (Phase 1: Authentication 版本)
// 假設 db 和 auth 變數已由 index.html 載入

document.addEventListener('DOMContentLoaded', () => {

    // --- 核心狀態變數 ---
    let state = new TicTacToeState();
    let gameOver = false;
    let localPlayerSymbol = null;
    let currentRoomId = null;
    let currentAILevel = "none";
    let unsubscribeGameListener = null; 
    let mctsWorker = null;
    
    // *** 新增：Auth 狀態變數 ***
    let currentUser = null; // { uid, displayName }

    const difficultyLevels = {
        "簡單": 50, "中等": 500, "困難": 2000, "超困難": 10000
    };

    // --- 獲取 DOM 元素 ---
    const statusLabel = document.getElementById('status-label');
    const authFrame = document.getElementById('auth-frame');
    const btnGoogleLogin = document.getElementById('btn-google-login');
    const lobbyFrame = document.getElementById('lobby-frame');
    const userDisplayName = document.getElementById('user-display-name');
    
    const gameInfoFrame = document.getElementById('game-info-frame');
    const roomIdDisplay = document.getElementById('room-id-display');
    const playerSymbolDisplay = document.getElementById('player-symbol-display');
    const gameVsDisplay = document.getElementById('game-vs-display'); // 新
    
    const boardFrame = document.getElementById('board-frame');
    const restartButton = document.getElementById('restart-button');
    const aiDifficultySelect = document.getElementById('ai-difficulty-select');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');
    const roomIdInput = document.getElementById('room-id-input');
    const boardButtons = [];

    // --- 初始化 Web Worker ---
    function initializeWorker() {
        if (window.Worker) {
            mctsWorker = new Worker('mcts_worker.js');
            mctsWorker.onmessage = function(e) {
                const move = e.data;
                onCellClick_AI(move);
            };
            mctsWorker.onerror = function(e) {
                console.error("Worker 發生錯誤:", e.message);
                statusLabel.textContent = "AI 運算錯誤";
            };
        } else {
            console.error("您的瀏覽器不支援 Web Workers！");
        }
    }

    // --- 初始化棋盤按鈕 ---
    function initializeBoardButtons() {
        for (let i = 0; i < 9; i++) {
            const button = document.createElement('button');
            button.classList.add('cell');
            button.dataset.index = i;
            button.disabled = true;
            button.addEventListener('click', () => onCellClick(i));
            boardFrame.appendChild(button);
            boardButtons.push(button);
        }
    }

    // --- Phase 1: Authentication 邏輯 ---
    function initializeAuth() {
        // 綁定登入按鈕
        btnGoogleLogin.addEventListener('click', signInWithGoogle);

        // 監聽 Auth 狀態變化
        auth.onAuthStateChanged(user => {
            if (user) {
                // === 玩家已登入 ===
                currentUser = {
                    uid: user.uid,
                    displayName: user.displayName.split(' ')[0] // 只取名字
                };
                
                statusLabel.textContent = "已登入。請建立或加入房間";
                userDisplayName.textContent = currentUser.displayName;
                
                // 顯示大廳，隱藏登入畫面
                authFrame.style.display = 'none';
                lobbyFrame.style.display = 'flex';
                
            } else {
                // === 玩家已登出 ===
                currentUser = null;
                statusLabel.textContent = "請先登入以進入大廳";
                
                // 顯示登入畫面，隱藏大廳
                authFrame.style.display = 'block';
                lobbyFrame.style.display = 'none';
                leaveRoom(); // 確保離開所有遊戲
            }
        });
    }

    async function signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            statusLabel.textContent = "正在登入...";
            await auth.signInWithPopup(provider);
            // 登入成功，onAuthStateChanged 會自動處理後續
        } catch (error) {
            console.error("Google 登入失敗:", error);
            statusLabel.textContent = "登入失敗: " + error.message;
        }
    }
    
    // (未來 Phase 2 會需要登出按鈕)
    // async function signOut() {
    //     await auth.signOut();
    // }

    // --- Phase 1: 遊戲邏輯 (更新) ---

    async function createRoom() {
        if (!currentUser) return alert("請先登入");
        
        localPlayerSymbol = 'X';
        currentAILevel = aiDifficultySelect.value;
        const roomId = (Math.floor(Math.random() * 90000) + 10000).toString();
        
        const newGameData = {
            board: Array(9).fill(' '),
            playerToMove: 'X',
            // 儲存玩家資訊
            players: {
                'X': {
                    uid: currentUser.uid,
                    name: currentUser.displayName,
                    aiLevel: currentAILevel
                },
                'O': null // O 玩家尚未加入
            },
            winner: null,
            status: 'waiting' // (為 Phase 2 準備)
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

    async function joinRoom() {
        if (!currentUser) return alert("請先登入");
        
        const roomId = roomIdInput.value.trim();
        if (!roomId) return alert("請輸入房間 ID");

        const roomRef = db.collection('games').doc(roomId);
        
        try {
            const doc = await roomRef.get();
            if (!doc.exists) return alert("錯誤：找不到該房間");

            const gameData = doc.data();
            
            if (gameData.players.O) {
                // 房間已滿，但檢查一下是不是自己
                if (gameData.players.O.uid === currentUser.uid || gameData.players.X.uid === currentUser.uid) {
                    // 這是我已經在的房間，重新加入
                    localPlayerSymbol = (gameData.players.X.uid === currentUser.uid) ? 'X' : 'O';
                    currentAILevel = (localPlayerSymbol === 'X') ? gameData.players.X.aiLevel : gameData.players.O.aiLevel;
                    await subscribeToGame(roomId);
                    return;
                }
                return alert("錯誤：此房間已滿");
            }

            localPlayerSymbol = 'O';
            currentAILevel = aiDifficultySelect.value;

            // 玩家 O 加入
            await roomRef.update({
                'players.O': {
                    uid: currentUser.uid,
                    name: currentUser.displayName,
                    aiLevel: currentAILevel
                },
                'status': 'full' // (為 Phase 2 準備)
            });
            
            await subscribeToGame(roomId);
        } catch (error) {
            console.error("加入房間失敗:", error);
            statusLabel.textContent = "錯誤：無法加入房間";
        }
    }

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
                    alert("房主已離開 (或房間被刪除)");
                    leaveRoom();
                    return;
                }
                handleGameUpdate(doc.data());
            }, (error) => {
                console.error("監聽失敗:", error);
                leaveRoom();
            });
    }

    function handleGameUpdate(gameData) {
        if (gameOver) return;

        state = new TicTacToeState(gameData.board, gameData.playerToMove);
        updateBoard(gameData.board);

        // 更新對戰名稱
        const playerXName = gameData.players.X ? gameData.players.X.name : "X";
        const playerOName = gameData.players.O ? gameData.players.O.name : "O (等待中...)";
        gameVsDisplay.textContent = `${playerXName} (X) vs ${playerOName} (O)`;

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
                statusLabel.textContent = `AI (${localPlayerSymbol}) 正在思考...`;
                boardButtons.forEach(btn => btn.disabled = true);
                triggerAITurn(state, difficultyLevels[currentAILevel]);
            } else {
                statusLabel.textContent = "輪到你了！";
            }
        } else {
            statusLabel.textContent = `等待 ${gameData.playerToMove === 'X' ? playerXName : playerOName} 下棋...`;
            boardButtons.forEach(btn => btn.disabled = true);
        }
    }
    
    // (onCellClick, triggerAITurn, onCellClick_AI, submitMove, ... )
    // ( ... 以下所有函式 (從 onCellClick 到 leaveRoom) 都保持不變 ... )
    // ( ... 請複製貼上您前一版 game.js 的這些函式 ... )

    async function onCellClick(index) {
        if (gameOver || state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ' || currentAILevel !== "none") {
            return;
        }
        await submitMove(index);
    }
    
    function triggerAITurn(currentState, iterations) {
        if (gameOver || mctsWorker === null) return;
        mctsWorker.postMessage({
            stateData: {
                board: currentState.board,
                playerToMove: currentState.playerToMove
            },
            iterations: iterations
        });
    }
    
    async function onCellClick_AI(index) {
        if (gameOver || state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ') {
            console.warn("AI 試圖下一個無效的棋步");
            return;
        }
        await submitMove(index);
    }

    async function submitMove(index) {
        if (gameOver) return;

        boardButtons.forEach(btn => btn.disabled = true);
        
        const newBoard = [...state.board];
        newBoard[index] = localPlayerSymbol;
        const newPlayerToMove = (localPlayerSymbol === 'X') ? 'O' : 'X';
        
        const tempState = new TicTacToeState(newBoard, newPlayerToMove);
        const winner = tempState.checkWinner();

        try {
            await db.collection('games').doc(currentRoomId).update({
                board: newBoard,
                playerToMove: newPlayerToMove,
                winner: winner
            });
        } catch (error) {
            console.error("提交移動失敗:", error);
            handleGameUpdate(state);
        }
    }

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
        
        // 只有房主 (X) 離開時才刪除房間
        if (localPlayerSymbol === 'X' && currentRoomId) {
             db.collection('games').doc(currentRoomId).delete().catch(() => {});
        }

        state = new TicTacToeState();
        gameOver = false;
        localPlayerSymbol = null;
        currentRoomId = null;
        
        // 隱藏遊戲，顯示大廳 (如果已登入)
        gameInfoFrame.style.display = 'none';
        restartButton.style.display = 'none';
        if (currentUser) {
            lobbyFrame.style.display = 'flex';
            statusLabel.textContent = "已登入。請建立或加入房間";
        }
        
        boardButtons.forEach(btn => {
            btn.textContent = ' ';
            btn.disabled = true;
        });
        
        roomIdInput.value = "";
    }
    
    // --- 程式進入點 ---
    initializeBoardButtons();
    initializeWorker();
    initializeAuth(); // *** 這是新的進入點 ***

}); // DOMContentLoaded 結束