const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = "2026";

const DATA_FILE = path.join(__dirname, "auction-data.json");

const INITIAL_BUDGET = 20000;
const BASE_PRICE = 200;

const TEAM_NAMES = [
    "Chida Team",
    "Peetham Team",
    "Siddu Team",
    "Nithin Team",
    "Kshamay Team"
];

/*
==========================================================
PLAYER LIST
==========================================================

IMPORTANT:
Every name is included.
Duplicate names are NOT removed.
Google Form YES/NO answers are NOT considered.
*/

const DEFAULT_PLAYERS = [
    "Adarsh",
    "Preetham KP",
    "Abhinayakumar",
    "Abhishek Purad",
    "Mahanth",
    "Sriniketh C.H",
    "Rohan",
    "CHIDANANDA G",
    "Daksh Sharma",
    "Mahesh S B",
    "Siddharth P H",
    "Prayas upase",
    "Varun N Shetty",
    "Sujal",
    "B Ajay",
    "SUHAS HANAMAPPA M",
    "Dhanush",
    "Preetham HM",
    "Balmukund",
    "Veda Prakash Reddy.O",
    "Vishwas",
    "Virupaksha kulkarni",
    "Achyuth",
    "Hithesh M O",
    "MEGHARAJ R M",
    "Halesh N M",
    "K Manoj",
    "Kshamay P Bharadwaj",
    "Shrikara M",
    "Jashwanth P",
    "Jogi",
    "Yashwanthkumar",
    "Amogha Bhat",
    "Shyam",
    "Tarun kulkarni",
    "B. Nithin",
    "Harsh Kumar",
    "Jeevan Bhat",
    "Dharanesh MN",
    "Krishna",
    "Chaluvaraj",
    "Akash C",
    "Manmith",
    "Vishnu",
    "Koushik ak",
    "Harsh Kumar",
    "Santanu Kumar Tunga",
    "Srikrishna",
    "Shrikant",
    "Shashank gowda s"
];

/*
==========================================================
CREATE FRESH AUCTION
==========================================================
*/

function createFreshAuction() {

    return {
        version: 2,

        players: DEFAULT_PLAYERS.map((name, index) => ({
            id: index + 1,
            name: name,
            status: "pending",
            team: null,
            amount: 0
        })),

        teams: TEAM_NAMES.map(name => ({
            name: name,
            budget: INITIAL_BUDGET,
            spent: 0,
            players: []
        })),

        current: 0,

        liveBid: BASE_PRICE,

        liveBidTeam: null,

        history: []
    };
}

/*
==========================================================
LOAD STATE
==========================================================
*/

let state;

function loadState() {

    try {

        if (!fs.existsSync(DATA_FILE)) {

            console.log("No saved auction found.");
            console.log("Creating fresh auction.");

            state = createFreshAuction();

            saveState();

            return;
        }

        const raw = fs.readFileSync(
            DATA_FILE,
            "utf8"
        );

        const saved = JSON.parse(raw);

        /*
        IMPORTANT:

        If the old JSON file has an old player list,
        don't allow it to replace our new list.

        We use version 2 for the new system.
        */

        if (
            !saved ||
            saved.version !== 2 ||
            !Array.isArray(saved.players)
        ) {

            console.log(
                "Old auction data detected."
            );

            console.log(
                "Creating new auction with current player list."
            );

            state = createFreshAuction();

            saveState();

            return;
        }

        state = saved;

        normalizeState();

        console.log(
            `Saved auction loaded: ${state.players.length} players`
        );

    } catch (error) {

        console.log(
            "Could not load saved auction."
        );

        console.log(error);

        state = createFreshAuction();

        saveState();
    }
}

/*
==========================================================
SAVE STATE
==========================================================
*/

function saveState() {

    try {

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(state, null, 2),
            "utf8"
        );

    } catch (error) {

        console.log(
            "Could not save auction:"
        );

        console.log(error);
    }
}

/*
==========================================================
NORMALIZE
==========================================================
*/

function normalizeState() {

    if (!state.players) {
        state.players = [];
    }

    if (!state.teams) {
        state.teams = [];
    }

    if (!state.history) {
        state.history = [];
    }

    if (
        typeof state.current !== "number" ||
        state.current < 0
    ) {
        state.current = 0;
    }

    if (
        typeof state.liveBid !== "number"
    ) {
        state.liveBid = BASE_PRICE;
    }

    if (
        state.liveBidTeam === undefined
    ) {
        state.liveBidTeam = null;
    }

    state.players.forEach((player, index) => {

        if (!player.id) {
            player.id = index + 1;
        }

        if (!player.name) {
            player.name = "Unnamed Player";
        }

        if (!player.status) {
            player.status = "pending";
        }

        if (
            typeof player.amount !== "number"
        ) {
            player.amount =
                Number(player.amount) || 0;
        }

        if (
            player.status !== "pending" &&
            player.status !== "sold" &&
            player.status !== "unsold"
        ) {
            player.status = "pending";
        }

        if (player.status !== "sold") {
            player.team = null;
            player.amount = 0;
        }
    });

    rebuildTeams();
}

/*
==========================================================
REBUILD TEAM INFORMATION
==========================================================
*/

function rebuildTeams() {

    const oldTeams = Array.isArray(state.teams)
        ? state.teams
        : [];

    const oldMap = {};

    oldTeams.forEach(team => {

        if (team && team.name) {
            oldMap[team.name] = team;
        }

    });

    state.teams = TEAM_NAMES.map(name => {

        const old = oldMap[name];

        return {
            name: name,

            budget:
                old &&
                typeof old.budget === "number"
                    ? old.budget
                    : INITIAL_BUDGET,

            spent: 0,

            players: []
        };
    });

    /*
    Recalculate from sold players.
    This prevents incorrect budgets.
    */

    state.players.forEach(player => {

        if (player.status !== "sold") {
            return;
        }

        const team = state.teams.find(
            t => t.name === player.team
        );

        if (!team) {
            return;
        }

        const price =
            Number(player.amount) || 0;

        team.spent += price;

        team.players.push({
            id: player.id,
            name: player.name,
            amount: price
        });
    });
}

/*
==========================================================
HISTORY
==========================================================
*/

function saveHistory() {

    const snapshot = {
        players: JSON.parse(
            JSON.stringify(state.players)
        ),

        current: state.current,

        liveBid: state.liveBid,

        liveBidTeam: state.liveBidTeam
    };

    state.history.push(snapshot);

    if (state.history.length > 50) {
        state.history.shift();
    }
}

/*
==========================================================
BROADCAST
==========================================================
*/

function broadcast() {

    rebuildTeams();

    saveState();

    io.emit(
        "state",
        getPublicState()
    );
}

/*
==========================================================
PUBLIC STATE
==========================================================
*/

function getPublicState() {

    rebuildTeams();

    return {
        version: state.version,

        players: state.players,

        teams: state.teams,

        current: state.current,

        liveBid: state.liveBid,

        liveBidTeam: state.liveBidTeam
    };
}

/*
==========================================================
ERROR
==========================================================
*/

function error(socket, message) {

    socket.emit(
        "errorMsg",
        message
    );
}

/*
==========================================================
VALID PLAYER
==========================================================
*/

function validPlayer(index) {

    return (
        Number.isInteger(index) &&
        index >= 0 &&
        index < state.players.length
    );
}

/*
==========================================================
STATIC FILES
==========================================================
*/

app.use(express.static(__dirname));

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );
});

/*
==========================================================
DOWNLOAD CSV
==========================================================
*/

app.get("/download-excel", (req, res) => {

    rebuildTeams();

    let csv = "";

    csv += "CRICKET AUCTION TEAM-WISE RESULTS\n\n";

    state.teams.forEach(team => {

        csv += `"${escapeCSV(team.name)}"\n`;

        csv += `"Player Name","Sold Price"\n`;

        if (team.players.length === 0) {

            csv += `"No players",""\n`;

        } else {

            team.players.forEach(player => {

                csv +=
                    `"${escapeCSV(player.name)}","${player.amount}"\n`;
            });
        }

        csv +=
            `"Total Spent","${team.spent}"\n`;

        csv +=
            `"Remaining Budget","${team.budget - team.spent}"\n`;

        csv += "\n";
    });

    csv += "\n";

    csv += `"ALL SOLD PLAYERS"\n`;

    csv += `"Player Name","Team","Price"\n`;

    state.players
        .filter(p => p.status === "sold")
        .forEach(player => {

            csv +=
                `"${escapeCSV(player.name)}","${escapeCSV(player.team)}","${player.amount}"\n`;
        });

    res.setHeader(
        "Content-Type",
        "text/csv; charset=utf-8"
    );

    res.setHeader(
        "Content-Disposition",
        "attachment; filename=cricket-auction-team-wise.csv"
    );

    res.send(csv);
});

function escapeCSV(value) {

    return String(value ?? "")
        .replace(/"/g, '""');
}

/*
==========================================================
SOCKET
==========================================================
*/

io.on("connection", socket => {

    console.log(
        "Connected:",
        socket.id
    );

    socket.emit(
        "state",
        getPublicState()
    );

    /*
    ========================================================
    LOGIN
    ========================================================
    */

    socket.on("login", pin => {

        const correct =
            String(pin) === ADMIN_PIN;

        socket.emit(
            "loginResult",
            correct
        );
    });

    /*
    ========================================================
    SELECT PLAYER
    ========================================================
    */

    socket.on("selectPlayer", index => {

        index = Number(index);

        if (!validPlayer(index)) {

            error(
                socket,
                "Invalid player."
            );

            return;
        }

        state.current = index;

        const player =
            state.players[index];

        if (player.status === "pending") {

            state.liveBid = BASE_PRICE;

            state.liveBidTeam = null;
        }

        broadcast();
    });

    /*
    ========================================================
    UPDATE BID
    ========================================================
    */

    socket.on("updateBid", data => {

        const playerIndex =
            Number(data.playerIndex);

        const teamIndex =
            Number(data.teamIndex);

        const amount =
            Number(data.amount);

        if (!validPlayer(playerIndex)) {

            error(
                socket,
                "Invalid player."
            );

            return;
        }

        if (!state.teams[teamIndex]) {

            error(
                socket,
                "Invalid team."
            );

            return;
        }

        if (
            !Number.isFinite(amount) ||
            amount < BASE_PRICE
        ) {

            error(
                socket,
                `Price must be at least ₹${BASE_PRICE}.`
            );

            return;
        }

        const player =
            state.players[playerIndex];

        const team =
            state.teams[teamIndex];

        if (player.status !== "pending") {

            error(
                socket,
                "This player is already completed."
            );

            return;
        }

        const remaining =
            team.budget - team.spent;

        if (amount > remaining) {

            error(
                socket,
                `${team.name} only has ₹${remaining} left.`
            );

            return;
        }

        state.current =
            playerIndex;

        state.liveBid =
            amount;

        state.liveBidTeam =
            teamIndex;

        broadcast();
    });

    /*
    ========================================================
    SOLD
    ========================================================
    */

    socket.on("sellPlayer", data => {

        const playerIndex =
            Number(data.playerIndex);

        const teamIndex =
            Number(data.teamIndex);

        const amount =
            Number(data.amount);

        if (!validPlayer(playerIndex)) {

            error(
                socket,
                "Invalid player."
            );

            return;
        }

        if (!state.teams[teamIndex]) {

            error(
                socket,
                "Invalid team."
            );

            return;
        }

        if (
            !Number.isFinite(amount) ||
            amount < BASE_PRICE
        ) {

            error(
                socket,
                "Invalid sale price."
            );

            return;
        }

        const player =
            state.players[playerIndex];

        const team =
            state.teams[teamIndex];

        if (player.status !== "pending") {

            error(
                socket,
                "This player is already completed."
            );

            return;
        }

        const remaining =
            team.budget - team.spent;

        if (amount > remaining) {

            error(
                socket,
                `${team.name} only has ₹${remaining} remaining.`
            );

            return;
        }

        /*
        SAVE BEFORE CHANGING
        */

        saveHistory();

        /*
        EXACT TEAM
        EXACT PRICE
        */

        player.status = "sold";

        player.team = team.name;

        player.amount = amount;

        state.current =
            playerIndex;

        state.liveBid =
            BASE_PRICE;

        state.liveBidTeam =
            null;

        broadcast();
    });

    /*
    ========================================================
    UNSOLD
    ========================================================
    */

    socket.on("markUnsold", index => {

        index =
            Number(index);

        if (!validPlayer(index)) {

            error(
                socket,
                "Invalid player."
            );

            return;
        }

        const player =
            state.players[index];

        if (player.status !== "pending") {

            error(
                socket,
                "Player is already completed."
            );

            return;
        }

        saveHistory();

        player.status = "unsold";

        player.team = null;

        player.amount = 0;

        state.current = index;

        state.liveBid = BASE_PRICE;

        state.liveBidTeam = null;

        broadcast();
    });

    /*
    ========================================================
    NEXT PLAYER
    ========================================================
    */

    socket.on("nextPlayer", () => {

        if (state.players.length === 0) {
            return;
        }

        let next =
            state.current + 1;

        if (
            next >=
            state.players.length
        ) {
            next = 0;
        }

        state.current = next;

        state.liveBid = BASE_PRICE;

        state.liveBidTeam = null;

        broadcast();
    });

    /*
    ========================================================
    UNDO
    ========================================================
    */

    socket.on("undo", () => {

        if (
            !state.history ||
            state.history.length === 0
        ) {

            error(
                socket,
                "Nothing to undo."
            );

            return;
        }

        const previous =
            state.history.pop();

        state.players =
            JSON.parse(
                JSON.stringify(
                    previous.players
                )
            );

        state.current =
            previous.current;

        state.liveBid =
            previous.liveBid;

        state.liveBidTeam =
            previous.liveBidTeam;

        rebuildTeams();

        saveState();

        io.emit(
            "state",
            getPublicState()
        );
    });

    /*
    ========================================================
    ADD PLAYER
    ========================================================
    */

    socket.on("addPlayer", name => {

        name =
            String(name || "").trim();

        if (!name) {

            error(
                socket,
                "Enter a player name."
            );

            return;
        }

        saveHistory();

        const ids =
            state.players.map(
                p => Number(p.id) || 0
            );

        const nextId =
            ids.length
                ? Math.max(...ids) + 1
                : 1;

        state.players.push({

            id: nextId,

            name: name,

            status: "pending",

            team: null,

            amount: 0
        });

        state.current =
            state.players.length - 1;

        state.liveBid = BASE_PRICE;

        state.liveBidTeam = null;

        broadcast();
    });

    /*
    ========================================================
    EDIT PLAYER
    ========================================================
    */

    socket.on("editPlayer", data => {

        const index =
            Number(data.index);

        const name =
            String(data.name || "").trim();

        if (!validPlayer(index)) {

            error(
                socket,
                "Invalid player."
            );

            return;
        }

        if (!name) {

            error(
                socket,
                "Enter a player name."
            );

            return;
        }

        saveHistory();

        state.players[index].name =
            name;

        broadcast();
    });

    /*
    ========================================================
    DELETE PLAYER
    ========================================================
    */

    socket.on("deletePlayer", index => {

        index =
            Number(index);

        if (!validPlayer(index)) {

            error(
                socket,
                "Invalid player."
            );

            return;
        }

        const player =
            state.players[index];

        if (player.status === "sold") {

            error(
                socket,
                "Sold player cannot be deleted. Correct the sale first."
            );

            return;
        }

        saveHistory();

        state.players.splice(
            index,
            1
        );

        if (
            state.current >=
            state.players.length
        ) {

            state.current =
                Math.max(
                    0,
                    state.players.length - 1
                );
        }

        broadcast();
    });

    /*
    ========================================================
    CORRECT SOLD PLAYER
    ========================================================
    */

    socket.on("correctSoldPlayer", data => {

        const index =
            Number(data.index);

        const teamIndex =
            Number(data.teamIndex);

        const amount =
            Number(data.amount);

        if (!validPlayer(index)) {

            error(
                socket,
                "Invalid player."
            );

            return;
        }

        if (!state.teams[teamIndex]) {

            error(
                socket,
                "Invalid team."
            );

            return;
        }

        if (
            !Number.isFinite(amount) ||
            amount < BASE_PRICE
        ) {

            error(
                socket,
                "Invalid price."
            );

            return;
        }

        const player =
            state.players[index];

        if (player.status !== "sold") {

            error(
                socket,
                "This player is not sold."
            );

            return;
        }

        rebuildTeams();

        const oldTeam =
            state.teams.find(
                t => t.name === player.team
            );

        const newTeam =
            state.teams[teamIndex];

        let available =
            newTeam.budget -
            newTeam.spent;

        /*
        If moving within the same team,
        return old price before checking.
        */

        if (
            oldTeam &&
            oldTeam.name === newTeam.name
        ) {

            available +=
                Number(player.amount) || 0;
        }

        if (amount > available) {

            error(
                socket,
                `${newTeam.name} only has ₹${available} available.`
            );

            return;
        }

        saveHistory();

        player.team =
            newTeam.name;

        player.amount =
            amount;

        player.status =
            "sold";

        state.current =
            index;

        rebuildTeams();

        broadcast();
    });

    /*
    ========================================================
    RESET AUCTION
    ========================================================
    */

    socket.on("resetAuction", () => {

        saveHistory();

        state =
            createFreshAuction();

        saveState();

        io.emit(
            "state",
            getPublicState()
        );
    });

    /*
    ========================================================
    DISCONNECT
    ========================================================
    */

    socket.on("disconnect", () => {

        console.log(
            "Disconnected:",
            socket.id
        );
    });
});

/*
==========================================================
START
==========================================================
*/

loadState();

rebuildTeams();

saveState();

server.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "====================================="
        );
        console.log(
            "🏏 CRICKET AUCTION LIVE"
        );
        console.log(
            "====================================="
        );
        console.log(
            `Port: ${PORT}`
        );
        console.log(
            `Players: ${state.players.length}`
        );
        console.log(
            `Teams: ${TEAM_NAMES.join(" | ")}`
        );
        console.log(
            `Admin PIN: ${ADMIN_PIN}`
        );
        console.log(
            "====================================="
        );
        console.log("");
    }
);
