// game.js (Phase 2: Public Lobby 版本)

document.addEventListener('DOMContentLoaded', () => {

    // --- 核心狀態變數 ---
    let state = new TicTacToeState();
    let gameOver = false;
    let localPlayerSymbol = null;
    let currentRoomId = null;
    let currentAILevel = "none";
    let unsubscribeGameListener = null; 
    let unsubscribeLobbyListener = null; // *** 新增：大廳監聽器 ***
    let mctsWorker = null;
    let currentUser = null; 

    const difficultyLevels = {
        "簡單": 50, "中等": 500, "困難": 2000, "超困難": 10000
    };

    // --- 獲取 DOM 元素 ---
    const statusLabel = document.getElementById('status-label');
    const authFrame = document.getElementById('auth-frame');
    const btnGoogleLogin = document.getElementById('btn-google-login');
    const lobbyFrame = document.getElementById('lobby-frame');
    const userDisplayName = document.getElementById('user-display-name');
    const btnSignOut = document.getElementById('btn-sign-out'); // 新
    const publicLobbyList = document.getElementById('public-lobby-list'); // 新
    
    const gameInfoFrame = document.getElementById('game-info-frame');
    const roomIdDisplay = document.getElementById('room-id-display');
    const playerSymbolDisplay = document.getElementById('player-symbol-display');
    const gameVsDisplay = document.getElementById('game-vs-display'); 
    
    const boardFrame = document.getElementById('board-frame');
    const restartButton = document.getElementById('restart-button');
    const aiDifficultySelect = document.getElementById('ai-difficulty-select');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');
    const roomIdInput = document.getElementById('room-id-input');
    const boardButtons = [];

    // --- (初始化函式保持不變) ---
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

    // --- Phase 1: Authentication 邏輯 (更新) ---
    function initializeAuth() {
        btnGoogleLogin.addEventListener('click', signInWithGoogle);
        btnSignOut.addEventListener('click', signOut); // *** 新增：登出按鈕 ***

        auth.onAuthStateChanged(user => {
            if (user) {
                // === 玩家已登入 ===
                currentUser = {
                    uid: user.uid,
                    displayName: user.displayName.split(' ')[0] 
                };
                
                statusLabel.textContent = "已登入。請建立或加入房間";
                userDisplayName.textContent = currentUser.displayName;
                
                authFrame.style.display = 'none';
                lobbyFrame.style.display = 'flex'; // *** 改成 flex ***
                
                // *** 新增：開始監聽大廳 ***
                listenForLobbyChanges();
                
            } else {
                // === 玩家已登出 ===
                currentUser = null;
                statusLabel.textContent = "請先登入以進入大廳";
                
                authFrame.style.display = 'block';
                lobbyFrame.style.display = 'none';
                
                // *** 新增：停止監聽大廳 ***
                if (unsubscribeLobbyListener) unsubscribeLobbyListener();
                
                leaveRoom(); // 確保離開所有遊戲
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
        await auth.signOut(); // onAuthStateChanged 會自動處理後續
    }

    // --- Phase 2: Public Lobby 邏輯 (全新！) ---
    
    function listenForLobbyChanges() {
        // 停止舊的監聽
        if (unsubscribeLobbyListener) unsubscribeLobbyListener();

        // 查詢所有 'status' 為 'waiting' 的遊戲
        unsubscribeLobbyListener = db.collection('games')
            .where('status', '==', 'waiting')
            .onSnapshot((querySnapshot) => {
                const games = [];
                querySnapshot.forEach((doc) => {
                    games.push({
                        id: doc.id,
                        data: doc.data()
                    });
                });
                renderLobby(games); // 渲染大廳列表
            }, (error) => {
                console.error("監聽大廳失敗:", error);
                publicLobbyList.innerHTML = '<p style="color: red;">無法載入大廳</p>';
            });
    }

    function renderLobby(games) {
        publicLobbyList.innerHTML = ''; // 清空列表

        if (games.length === 0) {
            publicLobbyList.innerHTML = '<p class="lobby-loading">目前沒有公開遊戲，快建立一個吧！</p>';
            return;
        }

        games.forEach(game => {
            // 不顯示自己開的房間
            if (game.data.players.X && game.data.players.X.uid === currentUser.uid) {
                return;
            }

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


    // --- Phase 1: 遊戲邏輯 (更新) ---
    
    // (createRoom 保持不變)
    async function createRoom() {
        if (!currentUser) return alert("請先登入");
        
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
            status: 'waiting' // 公開狀態，大廳會偵測到
        };

        try {
            await db.collection('games').doc(roomId).set(newGameData);
            await subscribeToGame(roomId); // 加入遊戲
        } catch (error) {
            console.error("建立房間失敗:", error);
            statusLabel.textContent = "錯誤：無法建立房間";
        }
    }

    // *** 綁定手動加入按鈕 ***
    btnJoinRoom.addEventListener('click', () => {
        const roomId = roomIdInput.value.trim();
        if (roomId) {
            joinGame(roomId); // 呼叫核心 joinGame 函式
        } else {
            alert("請輸入房間 ID");
        }
    });

    // *** 核心 `joinGame` 函式 (取代舊的 `joinRoom`) ***
    async function joinGame(roomId) {
        if (!currentUser) return alert("請先登入");
        if (!roomId) return; // 防呆

        const roomRef = db.collection('games').doc(roomId);
        
        try {
            const doc = await roomRef.get();
            if (!doc.exists) return alert("錯誤：找不到該房間");

            const gameData = doc.data();
            
            let joiningAs = null; // 'X', 'O', or 'spectator'
            
            if (gameData.players.X && gameData.players.X.uid === currentUser.uid) {
                joiningAs = 'X'; // 重新加入
            } else if (gameData.players.O && gameData.players.O.uid === currentUser.uid) {
                joiningAs = 'O'; // 重新加入
            } else if (!gameData.players.O) {
                joiningAs = 'O'; // 作為 O 加入
            }

            if (joiningAs === 'O' && !gameData.players.O) {
                // 這是玩家 O 第一次加入
                localPlayerSymbol = 'O';
                currentAILevel = aiDifficultySelect.value;
                await roomRef.update({
                    'players.O': {
                        uid: currentUser.uid,
                        name: currentUser.displayName,
                        aiLevel: currentAILevel
                    },
                    'status': 'full' // 遊戲開始，從大廳移除
                });
            } else if (joiningAs) {
                // 重新加入 (X 或 O)
                localPlayerSymbol = joiningAs;
                currentAILevel = gameData.players[joiningAs].aiLevel;
            } else {
                return alert("錯誤：此房間已滿 (或您不是玩家)");
            }
            
            await subscribeToGame(roomId); // 加入/監聽遊戲
        } catch (error) {
            console.error("加入房間失敗:", error);
            statusLabel.textContent = "錯誤：無法加入房間";
        }
    }

    async function subscribeToGame(roomId) {
        currentRoomId = roomId;
        
        // *** 停止監聽大廳 ***
        if (unsubscribeLobbyListener) {
            unsubscribeLobbyListener();
            unsubscribeLobbyListener = null;
        }
        
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
                    leaveRoom(); // leaveRoom 會自動重啟大廳監聽
                    return;
                }
                handleGameUpdate(doc.data());
            }, (error) => {
                console.error("監聽失敗:", error);
                leaveRoom();
            });
    }

    // (handleGameUpdate 保持不變)
    function handleGameUpdate(gameData) {
        if (gameOver) return;

        state = new TicTacToeState(gameData.board, gameData.playerToMove);
        updateBoard(gameData.board);

        const playerXName = gameData.players.X ? gameData.players.X.name : "X";
        const playerOName = gameData.players.O ? gameData.players.O.name : " (等待中...)";
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

    // (onCellClick, triggerAITurn, onCellClick_AI, submitMove, updateBoard 保持不變)
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


    // (leaveRoom 更新)
    function leaveRoom() {
        if (unsubscribeGameListener) {
            unsubscribeGameListener();
            unsubscribeGameListener = null;
        }
        
        // 房主 (X) 離開時刪除房間
        if (localPlayerSymbol === 'X' && currentRoomId) {
             db.collection('games').doc(currentRoomId).delete().catch(() => {});
        }

        state = new TicTacToeState();
        gameOver = false;
        localPlayerSymbol = null;
        currentRoomId = null;
        
        gameInfoFrame.style.display = 'none';
        restartButton.style.display = 'none';
        
        // *** 重新顯示大廳並重新監聽 (如果已登入) ***
        if (currentUser) {
            lobbyFrame.style.display = 'flex';
            statusLabel.textContent = "已登入。請建立或加入房間";
            listenForLobbyChanges(); // *** 重新啟動大廳監聽 ***
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
    initializeAuth(); // 保持不變，這會觸發所有流程

}); // DOMContentLoaded 結束