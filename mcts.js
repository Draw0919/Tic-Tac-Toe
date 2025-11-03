/* =================================================
 * 1. 遊戲狀態類 (TicTacToeState)
 * ================================================= */
class TicTacToeState {
    constructor(board = null, playerToMove = 'X') {
        this.board = board ? [...board] : Array(9).fill(' ');
        this.playerToMove = playerToMove;
        this.winner = this.checkWinner();
    }

    getLegalMoves() {
        if (this.winner) return [];
        const moves = [];
        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i] === ' ') {
                moves.push(i);
            }
        }
        return moves;
    }

    makeMove(move) {
        const newBoard = [...this.board];
        if (newBoard[move] === ' ') {
            newBoard[move] = this.playerToMove;
        }
        const newPlayer = this.playerToMove === 'X' ? 'O' : 'X';
        return new TicTacToeState(newBoard, newPlayer);
    }

    isTerminal() {
        return this.winner !== null;
    }

    checkWinner() {
        const winConditions = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // 橫
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // 豎
            [0, 4, 8], [2, 4, 6]             // 斜
        ];
        for (const [a, b, c] of winConditions) {
            if (this.board[a] === this.board[b] &&
                this.board[b] === this.board[c] &&
                this.board[a] !== ' ') {
                return this.board[a];
            }
        }
        if (!this.board.includes(' ')) {
            return 'draw';
        }
        return null; // 未結束
    }
}

/* =================================================
 * 2. MCTS 節點類 (MCTSNode)
 * ================================================= */
class MCTSNode {
    constructor(state, parent = null, move = null) {
        this.state = state;
        this.parent = parent;
        this.move = move;
        this.children = [];
        this.wins = 0;
        this.visits = 0;
        this.untriedMoves = this.state.getLegalMoves();
    }
}

/* =================================================
 * 3. MCTS 代理人類 (MCTSAgent)
 * ================================================= */
class MCTSAgent {
    constructor(iterations = 2000) {
        this.iterations = iterations;
        this.c = Math.sqrt(2); // 探索常數
    }

    findBestMove(initialState) {
        const root = new MCTSNode(initialState);

        for (let i = 0; i < this.iterations; i++) {
            let node = root;

            // 1. Selection
            while (node.untriedMoves.length === 0 && node.children.length > 0) {
                node = this._selectChild(node);
            }

            // 2. Expansion
            if (node.untriedMoves.length > 0) {
                const move = node.untriedMoves.pop();
                const newState = node.state.makeMove(move);
                node = new MCTSNode(newState, node, move);
                node.parent.children.push(node);
            }

            // 3. Simulation
            const result = this._simulate(node.state);

            // 4. Backpropagation
            this._backpropagate(node, result);
        }

        let bestChild = null;
        let maxVisits = -1;
        for (const child of root.children) {
            if (child.visits > maxVisits) {
                maxVisits = child.visits;
                bestChild = child;
            }
        }
        return bestChild.move;
    }

    _selectChild(node) {
        const logParentVisits = Math.log(node.visits);
        
        const ucb = (child) => {
            if (child.visits === 0) {
                return Infinity;
            }
            const exploitationTerm = 1.0 - (child.wins / child.visits);
            const explorationTerm = this.c * Math.sqrt(logParentVisits / child.visits);
            return exploitationTerm + explorationTerm;
        };
        
        // 找到 UCB 最高的子節點
        return node.children.reduce((a, b) => ucb(a) > ucb(b) ? a : b);
    }

    _simulate(state) {
        let currentState = state;
        const parentPlayer = currentState.playerToMove === 'X' ? 'O' : 'X';

        while (!currentState.isTerminal()) {
            const moves = currentState.getLegalMoves();
            const move = moves[Math.floor(Math.random() * moves.length)];
            currentState = currentState.makeMove(move);
        }

        const winner = currentState.checkWinner();
        if (winner === parentPlayer) return 1.0;
        if (winner === 'draw') return 0.5;
        return 0.0;
    }

    _backpropagate(node, result) {
        let tempNode = node;
        while (tempNode !== null) {
            tempNode.visits++;
            result = 1.0 - result; // Negamax
            tempNode.wins += result;
            tempNode = tempNode.parent;
        }
    }
}
