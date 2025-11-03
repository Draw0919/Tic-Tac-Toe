// game.js (Phase 3.5: 最終修復版 - 修正 AI 對戰 + 幽靈房間)

document.addEventListener('DOMContentLoaded', () => {

    // --- 核心狀態變數 ---
    let state = new TicTacToeState();
    let gameOver = false;
    let localPlayerSymbol = null;
    let currentRoomId = null;
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

    // --- Auth 邏輯 (確保所有按鈕都已綁定) ---
    function initializeAuth() {
        btnGoogleLogin.addEventListener('click', signInWithGoogle);
        btnSignOut.addEventListener('click', signOut);
        restartButton.addEventListener('click', leaveRoom); // 離開房間
        btnPlayAgain.addEventListener('click', requestRematch); // 再來一局
        btnCreatePVP.addEventListener('click', createRoom_PvP); // 建立 PvP
        btnCreatePVE.addEventListener('click', createRoom_PvE); // 建立 PvE
        btnJoinRoom.addEventListener('click', () => { // 手動加入
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

    // --- 遊戲邏輯 - 建立/加入 (Phase 3.4 邏輯) ---
    
    async function createRoom_PvP() {
        if (!currentUser) return;
        localPlayerSymbol = 'X';
        const roomId = (Math.floor(Math.random() * 90000) + 10000).toString();
        const newGameData = {
            board: Array(9).fill(' '),
            playerToMove: 'X',
            players: {
                'X': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: "none" },
                'O': null
            },
            winner: null,
            status: 'waiting',
            rematch: { X: false, O: false }
        };
        try {
            await db.collection('games').doc(roomId).set(newGameData);
            await subscribeToGame(roomId); // 建立後 *立刻* 加入
        } catch (error) { console.error("建立 PvP 房間失敗:", error); }
    }

    async function createRoom_PvE() {
        if (!currentUser) return;
        localPlayerSymbol = 'X';
        const opponentAILevel = aiDifficultySelect.value;
        const roomId = (Math.floor(Math.random() * 90000) + 10000).toString();
        const newGameData = {
            board: Array(9).fill(' '),
            playerToMove: 'X',
            players: {
                'X': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: "none" },
                'O': { uid: "AI_PLAYER", name: `MCTS (${opponentAILevel})`, aiLevel: opponentAILevel }
            },
            winner: null,
            status: 'full', // 遊戲立即開始
            rematch: { X: false, O: false }
        };
        try {
            await db.collection('games').doc(roomId).set(newGameData);
            await subscribeToGame(roomId); // 建立後 *立刻* 加入
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
                localPlayerSymbol = 'O';
                await roomRef.update({
                    'players.O': { uid: currentUser.uid, name: currentUser.displayName, aiLevel: "none" },
                    'status': 'full'
                });
            } else if (joiningAs) {
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
        restartButton.style.display = 'block'; 
        
        roomIdDisplay.textContent = currentRoomId;
        playerSymbolDisplay.textContent = localPlayerSymbol;

        if (unsubscribeGameListener) unsubscribeGameListener();
        unsubscribeGameListener = db.collection('games').doc(roomId)
            .onSnapshot((doc) => {
                if (!doc.exists) {
                    // 房主已離開 (或我們自己刪除了)
                    // 我們不需要 alert，因為 leaveRoom() 已經被呼叫了
                    return;
                }
                const oldBoard = [...state.board];
                handleGameUpdate(doc.data(), oldBoard);
            }, (error) => {
                console.error("監聽失敗:", error);
                leaveRoom();
            });
    }

    // --- (handleGameUpdate 保持 Phase 3.4 的邏輯) ---
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
            const opponentWantsRematch = opponentPlayer ? rematchData[opponentSymbol] : false;
            
            if (rematchData[localPlayerSymbol]) {
                btnPlayAgain.disabled = true;
                btnPlayAgain.textContent = opponentWantsRematch ? "正在重置..." : "等待對手...";
            } else {
                btnPlayAgain.disabled = false;
                btnPlayAgain.textContent = opponentWantsRematch ? "對手想再來一局！" : "再來一局";
            }
            
            if (opponentPlayer && opponentPlayer.aiLevel !== "none" && !rematchData[opponentSymbol]) {
                if (localPlayerSymbol === 'X') {
                    requestRematch_AI();
                }
            }
            const myAILevel = gameData.players[localPlayerSymbol] ? gameData.players[localPlayerSymbol].aiLevel : "none";
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
                statusLabel.textContent = `AI (${localPlayerSymbol}) 正在思考...`;
                boardButtons.forEach(btn => btn.disabled = true);
                triggerAITurn(state, difficultyLevels[myAILevel]);
            } else {
                statusLabel.textContent = "輪到你了！";
            }
        } else {
            const opponentSymbol = (localPlayerSymbol === 'X') ? 'O' : 'X';
            const opponentPlayer = gameData.players[opponentSymbol];
            
            if (opponentPlayer && opponentPlayer.aiLevel !== "none") {
                statusLabel.textContent = `AI (${opponentSymbol}) 正在思考...`;
                if (localPlayerSymbol === 'X') {
                    triggerAITurn(state, difficultyLevels[opponentPlayer.aiLevel]);
                }
            } else {
                statusLabel.textContent = `等待 ${opponentPlayer ? opponentPlayer.name : '...'} 下棋...`;
            }
            boardButtons.forEach(btn => btn.disabled = true);
        }
    }
    
    // --- (核心邏輯 - 保持不變) ---
    async function onCellClick(index) {
        if (gameOver) return;
        const gameData = (await db.collection('games').doc(currentRoomId).get()).data();
        if (!gameData) return;
        const myAILevel = gameData.players[localPlayerSymbol] ? gameData.players[localPlayerSymbol].aiLevel : "none";
        if (state.playerToMove !== localPlayerSymbol || state.board[index] !== ' ' || myAILevel !== "none") return;
        
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
        if (gameOver || state.board[index] !== ' ') return;
        await submitMove(index);
    }
    async function submitMove(index) {
        if (gameOver) return;
        boardButtons.forEach(btn => btn.disabled = true);
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

    // --- ("再來一局" 函式... 保持不變) ---
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
    async function requestRematch_AI() {
        if (!currentRoomId) return;
        const opponentSymbol = (localPlayerSymbol === 'X') ? 'O' : 'X';
        try {
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
    
    // --- (Phase 3.5: 修正 "幽靈房間" 的 leaveRoom 函式) ---
    async function leaveRoom() {
        // 1. 停止監聽舊遊戲
        if (unsubscribeGameListener) {
            unsubscribeGameListener();
            unsubscribeGameListener = null;
        }

        const roomToLeave = currentRoomId;
        const playerWhoLeft = localPlayerSymbol;

        // 2. *立刻* 重置所有本地 UI 狀態
        state = new TicTacToeState();
        gameOver = false;
        localPlayerSymbol = null;
        currentRoomId = null;
        
        gameInfoFrame.style.display = 'none';
        gameOverButtons.style.display = 'none';
        restartButton.style.display = 'none';
        
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

        // 3. (非同步) 在背景執行緩慢的資料庫操作
        try {
            if (playerWhoLeft === 'X' && roomToLeave) {
                // --- 我是玩家 X (房主) ---
                // 我必須 *刪除* 整個房間
                await db.collection('games').doc(roomToLeave).delete();
                
            } else if (playerWhoLeft === 'O' && roomToLeave) {
                // --- 我是玩家 O (加入者) ---
                const roomRef = db.collection('games').doc(roomToLeave);
                const doc = await roomRef.get();
                if (doc.exists) { // 確保房間還在
                    // 我必須 *重置* 房間，讓其他人可以加入
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
        } finally {
            // 4. *** 關鍵修復 ***
            // *直到* 資料庫操作完成後 (無論成功或失敗)，
            // 才重新監聽大廳
            if (currentUser) {
                listenForLobbyChanges();
            }
        }
    }
    
    // --- 程式進入點 (更新) ---
    initializeBoardButtons();
    initializeWorker();
    initializeAuth(); 
});