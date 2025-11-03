// game.js (Phase 3.4: 最終修復版 - AI 對戰 + 離開按鈕)

document.addEventListener('DOMContentLoaded', () => {

    // --- 核心狀態變數 ---
    let state = new TicTacToeState();
    let gameOver = false;
    let localPlayerSymbol = null;
    let currentRoomId = null;
    // 'currentAILevel' 已被 'myAILevel' 和 'opponentAILevel' 取代
    let unsubscribeGameListener = null; 
    let unsubscribeLobbyListener = null;
    let mctsWorker = null;
    let currentUser = null; 

    const difficultyLevels = {
        "簡單": 50, "中等": 500, "困難": 2000, "超困難": 10000
    };
    
    const WIN_CONDITIONS = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], 
        [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]
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
    const gameOverButtons = document.getElementById('game-over-buttons');
    const btnPlayAgain = document.getElementById('btn-play-again');
    const restartButton = document.getElementById('restart-button'); // "離開房間"
    
    const aiDifficultySelect = document.getElementById('ai-difficulty-select');
    // ** 新的按鈕 **
    const btnCreatePVP = document.getElementById('btn-create-pvp');
    const btnCreatePVE = document.getElementById('btn-create-pve');
    
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
        // 登入/登出
        btnGoogleLogin.addEventListener('click', signInWithGoogle);
        btnSignOut.addEventListener('click', signOut);

        // *** 修復 1：綁定「離開房間」按鈕 ***
        restartButton.addEventListener('click', leaveRoom);
        
        // "再來一局" 按鈕
        btnPlayAgain.addEventListener('click', requestRematch);
        
        // *** 修復 3：綁定新的大廳按鈕 ***
        btnCreatePVP.addEventListener('click', createRoom_PvP);
        btnCreatePVE.addEventListener('click', createRoom_PvE);

        // 手動加入 (保持不變)
        btnJoinRoom.addEventListener('click', () => {
            const roomId = roomIdInput.value.trim();
            if (roomId) joinGame(roomId);
            else alert("請輸入房間 ID");
        });

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
            .where('status', '==', 'waiting') // 只監聽等待中的 PvP 遊戲
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
    
    // *** 修復 3：新的 "建立 PvP" 函式 ***
    async function createRoom_PvP() {
        if (!currentUser) return;
        localPlayerSymbol = 'X';
        const roomId = (Math.floor(Math.random() * 90000) + 10000).toString();
        
        const newGameData = {
            board: Array(9).fill(' '),
            playerToMove: 'X',
            players: {
                'X': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: "none" }, // 房主 X 永遠是真人
                'O': null
            },
            winner: null,
            status: 'waiting', // 等待 O 加入
            rematch: { X: false, O: false }
        };
        try {
            await db.collection('games').doc(roomId).set(newGameData);
            await subscribeToGame(roomId);
        } catch (error) { console.error("建立 PvP 房間失敗:", error); }
    }

    // *** 修復 3：新的 "建立 PvE" 函式 ***
    async function createRoom_PvE() {
        if (!currentUser) return;
        localPlayerSymbol = 'X';
        const opponentAILevel = aiDifficultySelect.value;
        const roomId = (Math.floor(Math.random() * 90000) + 10000).toString();
        
        const newGameData = {
            board: Array(9).fill(' '),
            playerToMove: 'X',
            players: {
                'X': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: "none" }, // 房主 X 永遠是真人
                'O': { uid: "AI_PLAYER", name: `MCTS (${opponentAILevel})`, aiLevel: opponentAILevel } // AI 對手
            },
            winner: null,
            status: 'full', // 遊戲立即開始
            rematch: { X: false, O: false }
        };
        try {
            // 注意：PvE 遊戲*不*會出現在公開大廳 (因為 status 不是 'waiting')
            await db.collection('games').doc(roomId).set(newGameData);
            await subscribeToGame(roomId);
        } catch (error) { console.error("建立 PvE 房間失敗:", error); }
    }

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
                // 玩家 O (真人) 第一次加入
                localPlayerSymbol = 'O';
                await roomRef.update({
                    'players.O': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: "none" }, // 加入的 O 永遠是真人
                    'status': 'full'
                });
            } else if (joiningAs) {
                // 重新加入
                localPlayerSymbol = joiningAs;
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
        gameOverButtons.style.display = 'none';
        restartButton.style.display = 'block'; // *** 修復 2：確保「離開」按鈕可見 ***
        
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
                const oldBoard = [...state.board];
                handleGameUpdate(doc.data(), oldBoard);
            }, (error) => {
                console.error("監聽失敗:", error);
                leaveRoom();
            });
    }

    // --- (Phase 3.4: 更新 handleGameUpdate (AI 邏輯)) ---
    function handleGameUpdate(gameData, oldBoard) {
        if (gameOver && !gameData.winner) {
            gameOver = false;
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
            if (!gameOver) { 
                gameOver = true;
                statusLabel.textContent = "遊戲結束！";
                boardButtons.forEach(btn => btn.disabled = true);
                highlightWinLine(gameData.board, gameData.winner);
                let message = (gameData.winner === 'draw') ? "🤝 平局！ 🤝" : `🎉 玩家 ${gameData.winner} 獲勝！ 🎉`;
                setTimeout(() => alert(message), 100);
            }
            
            gameOverButtons.style.display = 'flex';
            const rematchData = gameData.rematch || { X: false, O: false };
            const opponentSymbol = (localPlayerSymbol === 'X') ? 'O' : 'X';
            const opponentPlayer = gameData.players[opponentSymbol];
            const opponentWantsRematch = rematchData[opponentSymbol];
            
            if (rematchData[localPlayerSymbol]) {
                btnPlayAgain.disabled = true;
                btnPlayAgain.textContent = opponentWantsRematch ? "正在重置..." : "等待對手...";
            } else {
                btnPlayAgain.disabled = false;
                btnPlayAgain.textContent = opponentWantsRematch ? "對手想再來一局！" : "再來一局";
            }
            
            // *** 修復 3：檢查 *對手* 是否是 AI ***
            if (opponentPlayer && opponentPlayer.aiLevel !== "none" && !rematchData[opponentSymbol]) {
                // 如果對手是 AI，AI 會自動同意再來一局
                // 只有房主 X 負責提交 AI (O) 的請求
                if (localPlayerSymbol === 'X') {
                    requestRematch_AI();
                }
            }
            // 檢查 *我* 是否是 AI
            const myAILevel = gameData.players[localPlayerSymbol].aiLevel;
            if (myAILevel !== "none" && !rematchData[localPlayerSymbol]) {
                requestRematch();
            }

            if (rematchData.X && rematchData.O) {
                if (localPlayerSymbol === 'X') {
                    resetGameForRematch(gameData);
                }
            }
            return;
        }

        // --- 遊戲進行中 ---
        gameOverButtons.style.display = 'none';
        
        const isMyTurn = (gameData.playerToMove === localPlayerSymbol);
        const myAILevel = gameData.players[localPlayerSymbol] ? gameData.players[localPlayerSymbol].aiLevel : "none";

        if (isMyTurn) {
            if (myAILevel !== "none") {
                // *** 輪到我，而我(AI)下棋 ***
                statusLabel.textContent = `AI (${localPlayerSymbol}) 正在思考...`;
                boardButtons.forEach(btn => btn.disabled = true);
                triggerAITurn(state, difficultyLevels[myAILevel]);
            } else {
                // *** 輪到我，而我(真人)下棋 ***
                statusLabel.textContent = "輪到你了！";
            }
        } else {
            // *** 輪到對手 ***
            const opponentSymbol = (localPlayerSymbol === 'X') ? 'O' : 'X';
            const opponentPlayer = gameData.players[opponentSymbol];
            
            if (opponentPlayer && opponentPlayer.aiLevel !== "none") {
                // *** 對手是 AI ***
                statusLabel.textContent = `AI (${opponentSymbol}) 正在思考...`;
                // *** 關鍵：只有房主 (X) 負責執行 AI (O) 的運算 ***
                if (localPlayerSymbol === 'X') {
                    triggerAITurn(state, difficultyLevels[opponentPlayer.aiLevel]);
                }
            } else {
                // *** 對手是真人或尚未加入 ***
                statusLabel.textContent = `等待 ${opponentPlayer ? opponentPlayer.name : '...'} 下棋...`;
            }
            boardButtons.forEach(btn => btn.disabled = true);
        }
    }
    
    // --- (核心邏輯 - onCellClick, triggerAITurn, onCellClick_AI 保持不變) ---
    async function onCellClick(index) {
        // (這只會被真人玩家觸發)
        const myAILevel = (localPlayerSymbol === 'X') ? (await db.collection('games').doc(currentRoomId).get()).data().players.X.aiLevel : (await db.collection('games').doc(currentRoomId).get()).data().players.O.aiLevel;
        if (gameOver || state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ' || myAILevel !== "none") return;
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
        // (這只會被 triggerAITurn 呼叫)
        if (gameOver || state.board[index] !== ' ') return;
        // AI 下棋時，它不需要檢查是否輪到 localPlayer
        await submitMove(index);
    }
    async function submitMove(index) {
        if (gameOver) return;
        boardButtons.forEach(btn => btn.disabled = true);
        
        // 獲取當前是誰在下棋
        const playerWhoMoved = state.playerToMove;
        
        const newBoard = [...state.board];
        newBoard[index] = playerWhoMoved;
        const newPlayerToMove = (playerWhoMoved === 'X') ? 'O' : 'X';
        const tempState = new TicTacToeState(newBoard, newPlayerToMove);
        const winner = tempState.checkWinner();
        try {
            await db.collection('games').doc(currentRoomId).update({
                board: newBoard,
                playerToMove: newPlayerToMove,
                winner: winner,
                rematch: { X: false, O: false }
            });
        } catch (error) {
            console.error("提交移動失敗:", error);
            handleGameUpdate(state, state.board);
        }
    }

    // --- (Phase 3.4: 新增 "再來一局" 函式) ---
    
    async function requestRematch() {
        if (!currentRoomId || !localPlayerSymbol) return;
        btnPlayAgain.disabled = true;
        btnPlayAgain.textContent = "等待對手...";
        try {
            await db.collection('games').doc(currentRoomId).update({
                [`rematch.${localPlayerSymbol}`]: true
            });
        } catch (error) { console.error("請求再來一局失敗:", error); }
    }
    
    // *** 新增：AI 請求再來一局 ***
    async function requestRematch_AI() {
        if (!currentRoomId) return;
        const opponentSymbol = (localPlayerSymbol === 'X') ? 'O' : 'X';
        try {
            // 房主 X 代表 AI O 提交請求
            await db.collection('games').doc(currentRoomId).update({
                [`rematch.${opponentSymbol}`]: true
            });
        } catch (error) { console.error("AI 請求再來一局失敗:", error); }
    }
    
    async function resetGameForRematch(gameData) {
        try {
            await db.collection('games').doc(currentRoomId).update({
                board: Array(9).fill(' '),
                playerToMove: 'X',
                winner: null,
                rematch: { X: false, O: false }
            });
        } catch (error) { console.error("重置遊戲失敗:", error); }
    }

    // --- (highlightWinLine 保持不變) ---
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
    
    // --- (Phase 3.3: 修正 leaveRoom 函式 - 保持不變) ---
    async function leaveRoom() {
        if (unsubscribeGameListener) {
            unsubscribeGameListener();
            unsubscribeGameListener = null;
        }
        const roomToLeave = currentRoomId;
        const playerWhoLeft = localPlayerSymbol;

        state = new TicTacToeState();
        gameOver = false;
        localPlayerSymbol = null;
        currentRoomId = null;
        
        gameInfoFrame.style.display = 'none';
        gameOverButtons.style.display = 'none';
        restartButton.style.display = 'none'; // *** 確保離開按鈕也被隱藏 ***
        
        boardButtons.forEach(btn => {
            btn.textContent = ' ';
            btn.disabled = true;
            btn.classList.remove('player-x', 'player-o', 'win-cell', 'animate-place');
        });
        roomIdInput.value = "";
        
        if (currentUser) {
            lobbyFrame.style.display = 'flex';
            statusLabel.textContent = "已登入。請建立或加入房間";
        }

        try {
            if (playerWhoLeft === 'X' && roomToLeave) {
                await db.collection('games').doc(roomToLeave).delete();
            } else if (playerWhoLeft === 'O' && roomToLeave) {
                const roomRef = db.collection('games').doc(roomToLeave);
                const doc = await roomRef.get();
                if (doc.exists) { // 確保房間還在
                    await roomRef.update({
                        'players.O': null,
                        'status': 'waiting',
                        'rematch': { X: false, O: false },
                        'board': Array(9).fill(' '),
                        'playerToMove': 'X',
                        'winner': null
                    });
                }
            }
        } catch (error) {
            console.error("離開房間時出錯:", error);
        }

        if (currentUser) {
            listenForLobbyChanges();
        }
    }
    
    // --- 程式進入點 (更新) ---
    initializeBoardButtons();
    initializeWorker();
    initializeAuth(); 
});