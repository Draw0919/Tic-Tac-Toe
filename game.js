// game.js (Phase 3.3: 最終版 - 加入 "Play Again")

document.addEventListener('DOMContentLoaded', () => {

    // --- 核心狀態變數 ---
    let state = new TicTacToeState();
    let gameOver = false;
    let localPlayerSymbol = null;
    let currentRoomId = null;
    let currentAILevel = "none";
    let unsubscribeGameListener = null; 
    let unsubscribeLobbyListener = null;
    let mctsWorker = null;
    let currentUser = null; 

    const difficultyLevels = {
        "簡單": 50, "中等": 500, "困難": 2000, "超困難": 10000
    };
    
    const WIN_CONDITIONS = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // 橫
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // 豎
        [0, 4, 8], [2, 4, 6]             // 斜
    ];

    // --- DOM 元素獲取 ---
    const statusLabel = document.getElementById('status-label');
    const authFrame = document.getElementById('auth-frame');
    const btnGoogleLogin = document.getElementById('btn-google-login');
    const lobbyFrame = document.getElementById('lobby-frame');
    const userDisplayName = document.getElementById('user-display-name');
    const btnSignOut = document.getElementById('btn-sign-out');
    const publicLobbyList = document.getElementById('public-lobby-list');
    const gameInfoFrame = document.getElementById('game-info-frame');
    const roomIdDisplay = document.getElementById('room-id-display');
    const playerSymbolDisplay = document.getElementById('player-symbol-display');
    const gameVsDisplay = document.getElementById('game-vs-display'); 
    const boardFrame = document.getElementById('board-frame');
    
    // *** 獲取新/移動過的按鈕 ***
    const gameOverButtons = document.getElementById('game-over-buttons');
    const btnPlayAgain = document.getElementById('btn-play-again');
    const restartButton = document.getElementById('restart-button'); // "離開房間"
    
    const aiDifficultySelect = document.getElementById('ai-difficulty-select');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');
    const roomIdInput = document.getElementById('room-id-input');
    const boardButtons = [];

    // --- (初始化函式... 保持不變) ---
    function initializeWorker() {
        if (window.Worker) {
            mctsWorker = new Worker('mcts_worker.js');
            mctsWorker.onmessage = function(e) { onCellClick_AI(e.data); };
            mctsWorker.onerror = function(e) {
                console.error("Worker 發生錯誤:", e.message);
                statusLabel.textContent = "AI 運算錯誤";
            };
        } else { console.error("您的瀏覽器不支援 Web Workers！"); }
    }

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

    // --- Auth 邏輯 (更新) ---
    function initializeAuth() {
        btnGoogleLogin.addEventListener('click', signInWithGoogle);
        btnSignOut.addEventListener('click', signOut);

        restartButton.addEventListener('click', leaveRoom);
        
        btnPlayAgain.addEventListener('click', requestRematch);

        auth.onAuthStateChanged(user => {
            if (user) {
                currentUser = { uid: user.uid, displayName: user.displayName.split(' ')[0] };
                statusLabel.textContent = "已登入。請建立或加入房間";
                userDisplayName.textContent = currentUser.displayName;
                authFrame.style.display = 'none';
                lobbyFrame.style.display = 'flex';
                listenForLobbyChanges();
            } else {
                currentUser = null;
                statusLabel.textContent = "請先登入以進入大廳";
                authFrame.style.display = 'block';
                lobbyFrame.style.display = 'none';
                if (unsubscribeLobbyListener) unsubscribeLobbyListener();
                leaveRoom();
            }
        });
    }

    async function signInWithGoogle() {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            statusLabel.textContent = "正在登入...";
            await auth.signInWithPopup(provider);
        } catch (error) {
            console.error("Google 登入失敗:", error);
            statusLabel.textContent = "登入失敗: " + error.message;
        }
    }
    
    async function signOut() {
        await auth.signOut();
    }

    // --- Lobby 邏輯 (保持不變) ---
    function listenForLobbyChanges() {
        if (unsubscribeLobbyListener) unsubscribeLobbyListener();
        unsubscribeLobbyListener = db.collection('games')
            .where('status', '==', 'waiting')
            .onSnapshot((querySnapshot) => {
                const games = [];
                querySnapshot.forEach((doc) => {
                    games.push({ id: doc.id, data: doc.data() });
                });
                renderLobby(games);
            }, (error) => {
                console.error("監聽大廳失敗:", error);
                publicLobbyList.innerHTML = '<p style="color: red;">無法載入大廳</p>';
            });
    }
    function renderLobby(games) {
        publicLobbyList.innerHTML = '';
        if (games.length === 0) {
            publicLobbyList.innerHTML = '<p class="lobby-loading">目前沒有公開遊戲...</p>';
        }
        games.forEach(game => {
            if (game.data.players.X && game.data.players.X.uid === currentUser.uid) return;
            const item = document.createElement('div');
            item.classList.add('lobby-game-item');
            const name = document.createElement('span');
            name.textContent = `${game.data.players.X.name} 的遊戲`;
            item.appendChild(name);
            const joinBtn = document.createElement('button');
            joinBtn.textContent = '加入';
            joinBtn.addEventListener('click', () => joinGame(game.id));
            item.appendChild(joinBtn);
            publicLobbyList.appendChild(item);
        });
    }

    // --- 遊戲邏輯 - 建立/加入 (更新) ---
    
    // *** 修復 1：綁定「建立房間」按鈕 ***
    btnCreateRoom.addEventListener('click', createRoom);
    
    async function createRoom() {
        if (!currentUser) return;
        localPlayerSymbol = 'X';
        currentAILevel = aiDifficultySelect.value;
        const roomId = (Math.floor(Math.random() * 90000) + 10000).toString();
        const newGameData = {
            board: Array(9).fill(' '),
            playerToMove: 'X',
            players: {
                'X': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: currentAILevel },
                'O': null
            },
            winner: null,
            status: 'waiting',
            rematch: { X: false, O: false } // *** 新增 rematch 欄位 ***
        };
        try {
            await db.collection('games').doc(roomId).set(newGameData);
            await subscribeToGame(roomId);
        } catch (error) { console.error("建立房間失敗:", error); }
    }

    btnJoinRoom.addEventListener('click', () => {
        const roomId = roomIdInput.value.trim();
        if (roomId) joinGame(roomId);
        else alert("請輸入房間 ID");
    });

    async function joinGame(roomId) {
        if (!currentUser || !roomId) return;
        const roomRef = db.collection('games').doc(roomId);
        try {
            const doc = await roomRef.get();
            if (!doc.exists) return alert("錯誤：找不到該房間");
            const gameData = doc.data();
            let joiningAs = null;
            
            if (gameData.players.X && gameData.players.X.uid === currentUser.uid) joiningAs = 'X';
            else if (gameData.players.O && gameData.players.O.uid === currentUser.uid) joiningAs = 'O';
            else if (!gameData.players.O) joiningAs = 'O';

            if (joiningAs === 'O' && !gameData.players.O) {
                localPlayerSymbol = 'O';
                currentAILevel = aiDifficultySelect.value;
                await roomRef.update({
                    'players.O': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: currentAILevel },
                    'status': 'full'
                });
            } else if (joiningAs) {
                localPlayerSymbol = joiningAs;
                currentAILevel = (gameData.players[joiningAs] && gameData.players[joiningAs].aiLevel) ? gameData.players[joiningAs].aiLevel : "none";
            } else {
                return alert("錯誤：此房間已滿");
            }
            await subscribeToGame(roomId);
        } catch (error) { console.error("加入房間失敗:", error); }
    }

    async function subscribeToGame(roomId) {
        currentRoomId = roomId;
        if (unsubscribeLobbyListener) {
            unsubscribeLobbyListener();
            unsubscribeLobbyListener = null;
        }
        lobbyFrame.style.display = 'none';
        gameInfoFrame.style.display = 'block';
        gameOverButtons.style.display = 'none'; // 隱藏遊戲結束按鈕
        
        roomIdDisplay.textContent = currentRoomId;
        playerSymbolDisplay.textContent = localPlayerSymbol;

        if (unsubscribeGameListener) unsubscribeGameListener();
        unsubscribeGameListener = db.collection('games').doc(roomId)
            .onSnapshot((doc) => {
                if (!doc.exists) {
                    alert("房主已離開");
                    leaveRoom();
                    return;
                }
                const oldBoard = [...state.board]; // 儲存舊棋盤
                handleGameUpdate(doc.data(), oldBoard);
            }, (error) => {
                console.error("監聽失敗:", error);
                leaveRoom();
            });
    }

    // --- (Phase 3.3: 更新 handleGameUpdate) ---
    function handleGameUpdate(gameData, oldBoard) {
        if (gameOver && !gameData.winner) {
            // 遊戲剛重置
            gameOver = false;
            // 清除所有動畫
            boardButtons.forEach(btn => {
                btn.classList.remove('win-cell', 'animate-place');
            });
        }
        
        state = new TicTacToeState(gameData.board, gameData.playerToMove);
        updateBoard(gameData.board, oldBoard); 

        const playerXName = gameData.players.X ? gameData.players.X.name : "X";
        const playerOName = gameData.players.O ? gameData.players.O.name : " (等待中...)";
        gameVsDisplay.textContent = `${playerXName} (X) vs ${playerOName} (O)`;

        if (gameData.winner) {
            if (!gameOver) { // 只在剛結束時觸發一次
                gameOver = true;
                statusLabel.textContent = "遊戲結束！";
                boardButtons.forEach(btn => btn.disabled = true);
                highlightWinLine(gameData.board, gameData.winner);
                let message = (gameData.winner === 'draw') ? "🤝 平局！ 🤝" : `🎉 玩家 ${gameData.winner} 獲勝！ 🎉`;
                setTimeout(() => alert(message), 100);
            }
            
            // *** 新增：處理 "再來一局" 邏輯 ***
            gameOverButtons.style.display = 'flex'; // 顯示按鈕
            const rematchData = gameData.rematch || { X: false, O: false };
            
            // 檢查對方
            const opponentSymbol = (localPlayerSymbol === 'X') ? 'O' : 'X';
            const opponentWantsRematch = rematchData[opponentSymbol];
            
            if (rematchData[localPlayerSymbol]) {
                // 我已經點了
                btnPlayAgain.disabled = true;
                btnPlayAgain.textContent = opponentWantsRematch ? "正在重置..." : "等待對手...";
            } else {
                // 我還沒點
                btnPlayAgain.disabled = false;
                btnPlayAgain.textContent = opponentWantsRematch ? "對手想再來一局！" : "再來一局";
            }
            
            // 檢查 AI 是否自動點擊
            if (currentAILevel !== "none" && !rematchData[localPlayerSymbol]) {
                requestRematch();
            }
            
            // 檢查是否雙方都同意
            if (rematchData.X && rematchData.O) {
                // 只有 P1 (X) 負責重置遊戲，避免雙方同時重置
                if (localPlayerSymbol === 'X') {
                    resetGameForRematch(gameData);
                }
            }
            
            return; // 遊戲結束，停止後續檢查
        }

        // --- 遊戲進行中 ---
        
        // 確保遊戲結束按鈕是隱藏的
        gameOverButtons.style.display = 'none';
        
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
    
    // --- (核心邏輯 - 保持不變) ---
    async function onCellClick(index) {
        if (gameOver || state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ' || currentAILevel !== "none") return;
        await submitMove(index);
    }
    function triggerAITurn(currentState, iterations) {
        if (gameOver || mctsWorker === null) return;
        mctsWorker.postMessage({
            stateData: { board: currentState.board, playerToMove: currentState.playerToMove },
            iterations: iterations
        });
    }
    async function onCellClick_AI(index) {
        if (gameOver || state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ') return;
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
                winner: winner,
                rematch: { X: false, O: false } // *** 重置 rematch 狀態 ***
            });
        } catch (error) {
            console.error("提交移動失敗:", error);
            handleGameUpdate(state, state.board);
        }
    }

    // --- (Phase 3.3: 新增 "再來一局" 函式) ---
    
    async function requestRematch() {
        if (!currentRoomId || !localPlayerSymbol) return;
        
        btnPlayAgain.disabled = true;
        btnPlayAgain.textContent = "等待對手...";
        
        try {
            // 使用 . 符號來更新 nested object
            await db.collection('games').doc(currentRoomId).update({
                [`rematch.${localPlayerSymbol}`]: true
            });
        } catch (error) {
            console.error("請求再來一局失敗:", error);
            btnPlayAgain.disabled = false;
        }
    }
    
    async function resetGameForRematch(gameData) {
        // 重置遊戲狀態，但保留玩家和 AI 設定
        try {
            await db.collection('games').doc(currentRoomId).update({
                board: Array(9).fill(' '),
                playerToMove: 'X', // X 永遠先手
                winner: null,
                rematch: { X: false, O: false }
            });
            // onSnapshot 會自動偵測到變更並重置 'gameOver' 狀態
        } catch (error) {
            console.error("重置遊戲失敗:", error);
        }
    }

    // --- (updateBoard, highlightWinLine 保持不變) ---
    function updateBoard(board, oldBoard = null) {
        const isMyTurn = (state.playerToMove === localPlayerSymbol);
        for (let i = 0; i < 9; i++) {
            const piece = board[i];
            const oldPiece = oldBoard ? oldBoard[i] : ' ';
            boardButtons[i].classList.remove('animate-place');
            boardButtons[i].textContent = piece;
            boardButtons[i].classList.remove('player-x', 'player-o');
            if (piece === 'X') boardButtons[i].classList.add('player-x');
            if (piece === 'O') boardButtons[i].classList.add('player-o');
            if (piece !== ' ' && oldPiece === ' ') {
                boardButtons[i].classList.add('animate-place');
            }
            if (gameOver || state.winner) {
                boardButtons[i].disabled = true;
            } else if (isMyTurn && currentAILevel === "none" && piece === ' ') {
                boardButtons[i].disabled = false;
            } else {
                boardButtons[i].disabled = true;
            }
        }
    }
    function highlightWinLine(board, winner) {
        let winLine = null;
        for (const line of WIN_CONDITIONS) {
            const [a, b, c] = line;
            if (board[a] === winner && board[b] === winner && board[c] === winner) {
                winLine = line;
                break;
            }
        }
        if (winLine) {
            winLine.forEach(index => {
                boardButtons[index].classList.add('win-cell');
            });
        }
    }

    // --- (Phase 3.3: 更新 leaveRoom) ---
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
        
        gameInfoFrame.style.display = 'none';
        gameOverButtons.style.display = 'none'; // *** 隱藏按鈕 ***
        
        if (currentUser) {
            lobbyFrame.style.display = 'flex';
            statusLabel.textContent = "已登入。請建立或加入房間";
            listenForLobbyChanges();
        }
        
        boardButtons.forEach(btn => {
            btn.textContent = ' ';
            btn.disabled = true;
            btn.classList.remove('player-x', 'player-o', 'win-cell', 'animate-place');
        });
        
        roomIdInput.value = "";
    }
    
    // --- 程式進入點 (更新) ---
    initializeBoardButtons();
    initializeWorker();
    // *** 這是新的進入點 ***
    initializeAuth(); 
});