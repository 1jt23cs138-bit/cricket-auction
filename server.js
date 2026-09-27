const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const ADMIN_PIN = "2026";

const DATA_FILE = path.join(
    __dirname,
    "auction-data.json"
);

/*
========================================================
DEFAULT AUCTION DATA
========================================================
*/

const DEFAULT_TEAMS = [
    {
        name: "Team Chida",
        budget: 10000,
        spent: 0,
        players: []
    },
    {
        name: "Team Suraj",
        budget: 10000,
        spent: 0,
        players: []
    },
    {
        name: "Team Yash",
        budget: 10000,
        spent: 0,
        players: []
    },
    {
        name: "Team Rahul",
        budget: 10000,
        spent: 0,
        players: []
    }
];


const DEFAULT_PLAYERS = [
    {
        name: "Abhinay",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Akash",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Arjun",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Bharath",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Chetan",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Dhanush",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Karthik",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Manoj",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Rahul",
        status: "pending",
        team: null,
        amount: 0
    },
    {
        name: "Rohit",
        status: "pending",
        team: null,
        amount: 0
    }
];


/*
========================================================
CREATE DEFAULT STATE
========================================================
*/

function createDefaultState() {

    return {
        players: JSON.parse(
            JSON.stringify(DEFAULT_PLAYERS)
        ),

        teams: JSON.parse(
            JSON.stringify(DEFAULT_TEAMS)
        ),

        current: 0,

        liveBid: 200,

        liveBidTeam: "",

        history: []
    };
}


/*
========================================================
LOAD DATA
========================================================
*/

let state;


function loadState() {

    try {

        if (
            fs.existsSync(DATA_FILE)
        ) {

            const data =
                fs.readFileSync(
                    DATA_FILE,
                    "utf8"
                );

            state =
                JSON.parse(data);

            normalizeState();

        } else {

            state =
                createDefaultState();

            saveState();

        }

    } catch (error) {

        console.log(
            "Error loading auction data:",
            error
        );

        state =
            createDefaultState();

        saveState();

    }

}


loadState();


/*
========================================================
NORMALIZE STATE
========================================================
*/

function normalizeState() {

    if (
        !state ||
        typeof state !== "object"
    ) {

        state =
            createDefaultState();

        return;

    }


    if (
        !Array.isArray(
            state.players
        )
    ) {

        state.players = [];

    }


    if (
        !Array.isArray(
            state.teams
        )
    ) {

        state.teams =
            JSON.parse(
                JSON.stringify(
                    DEFAULT_TEAMS
                )
            );

    }


    if (
        !Array.isArray(
            state.history
        )
    ) {

        state.history = [];

    }


    if (
        typeof state.current !==
        "number"
    ) {

        state.current = 0;

    }


    if (
        typeof state.liveBid !==
        "number"
    ) {

        state.liveBid = 200;

    }


    if (
        state.liveBidTeam ===
        undefined
    ) {

        state.liveBidTeam = "";

    }


    state.players.forEach(
        player => {

            if (
                !player.status
            ) {

                player.status =
                    "pending";

            }

            if (
                player.team ===
                undefined
            ) {

                player.team = null;

            }

            if (
                player.amount ===
                undefined
            ) {

                player.amount = 0;

            }

        }
    );


    state.teams.forEach(
        team => {

            if (
                !Array.isArray(
                    team.players
                )
            ) {

                team.players = [];

            }

            if (
                typeof team.budget !==
                "number"
            ) {

                team.budget = 10000;

            }

            if (
                typeof team.spent !==
                "number"
            ) {

                team.spent = 0;

            }

        }
    );

}


/*
========================================================
SAVE DATA
========================================================
*/

function saveState() {

    try {

        fs.writeFileSync(
            DATA_FILE,

            JSON.stringify(
                state,
                null,
                2
            ),

            "utf8"
        );

    } catch (error) {

        console.log(
            "Error saving auction data:",
            error
        );

    }

}


/*
========================================================
BROADCAST
========================================================
*/

function broadcast() {

    saveState();

    io.emit(
        "update",
        state
    );

}


/*
========================================================
REBUILD TEAM DATA
========================================================
*/

function rebuildTeams() {

    state.teams.forEach(
        team => {

            team.spent = 0;

            team.players = [];

        }
    );


    state.players.forEach(
        player => {

            if (
                player.status !==
                "sold"
            ) {

                return;

            }


            const team =
                state.teams.find(
                    t =>
                        t.name ===
                        player.team
                );


            if (!team) {

                return;

            }


            const amount =
                Number(
                    player.amount
                ) || 0;


            team.spent +=
                amount;


            team.players.push({

                name:
                    player.name,

                amount:
                    amount

            });

        }
    );

}


/*
========================================================
STATIC FILES
========================================================
*/

app.use(
    express.static(
        __dirname
    )
);


/*
========================================================
HOME PAGE
========================================================
*/

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );

    }
);


/*
========================================================
DOWNLOAD TEAM-WISE CSV
========================================================
*/

app.get(
    "/download-excel",
    (req, res) => {

        rebuildTeams();


        let csv = "";


        state.teams.forEach(
            team => {

                csv +=
                    `"${team.name}"\n`;

                csv +=
                    `"Player Name","Price"\n`;


                if (
                    team.players.length ===
                    0
                ) {

                    csv +=
                        `"No players bought",""\n`;

                } else {

                    team.players.forEach(
                        player => {

                            csv +=
                                `"${escapeCSV(
                                    player.name
                                )}","${player.amount}"\n`;

                        }
                    );

                }


                csv +=
                    `"Total Spent","${team.spent}"\n`;

                csv +=
                    `"Remaining Budget","${
                        team.budget -
                        team.spent
                    }"\n`;

                csv +=
                    `\n\n`;

            }
        );


        /*
        Add complete player list
        */

        csv +=
            `"ALL SOLD PLAYERS"\n`;

        csv +=
            `"Player Name","Team","Price"\n`;


        state.players
            .filter(
                player =>
                    player.status ===
                    "sold"
            )
            .forEach(
                player => {

                    csv +=

                        `"${escapeCSV(
                            player.name
                        )}","${escapeCSV(
                            player.team
                        )}","${player.amount}"\n`;

                }
            );


        res.setHeader(
            "Content-Type",
            "text/csv"
        );


        res.setHeader(
            "Content-Disposition",
            "attachment; filename=cricket-auction-team-wise.csv"
        );


        res.send(csv);

    }
);


/*
========================================================
CSV ESCAPE
========================================================
*/

function escapeCSV(value) {

    return String(
        value ?? ""
    )
    .replace(
        /"/g,
        '""'
    );

}


/*
========================================================
SOCKET.IO
========================================================
*/

io.on(
    "connection",
    socket => {

        console.log(
            "Client connected:",
            socket.id
        );


        /*
        Send current state
        */

        socket.emit(
            "update",
            state
        );


        /*
        ================================================
        ADMIN LOGIN
        ================================================
        */

        socket.on(
            "login",
            pin => {

                const success =
                    String(pin) ===
                    ADMIN_PIN;


                socket.emit(
                    "login",
                    success
                );

            }
        );


        /*
        ================================================
        SELECT PLAYER
        ================================================
        */

        socket.on(
            "select",
            index => {

                if (
                    !isValidPlayerIndex(
                        index
                    )
                ) {

                    return;

                }


                state.current =
                    Number(index);


                const player =
                    state.players[
                        state.current
                    ];


                if (
                    player.status ===
                    "pending"
                ) {

                    state.liveBid =
                        200;

                    state.liveBidTeam =
                        "";

                }


                broadcast();

            }
        );


        /*
        ================================================
        BID
        ================================================
        */

        socket.on(
            "bid",
            data => {

                const playerIndex =
                    Number(
                        data?.playerIndex
                    );


                const amount =
                    Number(
                        data?.amount
                    );


                const teamIndex =
                    Number(
                        data?.team
                    );


                if (
                    !isValidPlayerIndex(
                        playerIndex
                    )
                ) {

                    sendError(
                        socket,
                        "Invalid player."
                    );

                    return;

                }


                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount < 200
                ) {

                    sendError(
                        socket,
                        "Invalid bid amount."
                    );

                    return;

                }


                if (
                    !state.teams[
                        teamIndex
                    ]
                ) {

                    sendError(
                        socket,
                        "Invalid team."
                    );

                    return;

                }


                const player =
                    state.players[
                        playerIndex
                    ];


                if (
                    player.status !==
                    "pending"
                ) {

                    sendError(
                        socket,
                        "Player is not available."
                    );

                    return;

                }


                const team =
                    state.teams[
                        teamIndex
                    ];


                const remaining =
                    team.budget -
                    team.spent;


                if (
                    amount >
                    remaining
                ) {

                    sendError(
                        socket,

                        `${team.name} only has ₹${remaining} remaining.`
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

            }
        );


        /*
        ================================================
        SOLD
        ================================================
        */

        socket.on(
            "sold",
            data => {

                sellPlayer(
                    socket,
                    data
                );

            }
        );


        /*
        ================================================
        UNSOLD
        ================================================
        */

        socket.on(
            "unsold",
            () => {

                const player =
                    state.players[
                        state.current
                    ];


                if (!player) {

                    return;

                }


                if (
                    player.status !==
                    "pending"
                ) {

                    sendError(
                        socket,
                        "Player is already completed."
                    );

                    return;

                }


                saveHistory();


                player.status =
                    "unsold";


                player.team =
                    null;


                player.amount =
                    0;


                state.liveBid =
                    200;


                state.liveBidTeam =
                    "";


                broadcast();

            }
        );


        /*
        ================================================
        NEXT PLAYER
        ================================================
        */

        socket.on(
            "next",
            () => {

                if (
                    state.players.length ===
                    0
                ) {

                    return;

                }


                let next =
                    state.current + 1;


                /*
                Wrap around
                */

                if (
                    next >=
                    state.players.length
                ) {

                    next = 0;

                }


                state.current =
                    next;


                state.liveBid =
                    200;


                state.liveBidTeam =
                    "";


                broadcast();

            }
        );


        /*
        ================================================
        UNDO LAST SALE
        ================================================
        */

        socket.on(
            "undoSale",
            () => {

                undoLastAction(
                    socket
                );

            }
        );


        /*
        ================================================
        ADD PLAYER
        ================================================
        */

        socket.on(
            "addPlayer",
            name => {

                name =
                    String(
                        name || ""
                    ).trim();


                if (!name) {

                    sendError(
                        socket,
                        "Player name is required."
                    );

                    return;

                }


                if (
                    state.players.some(
                        p =>
                            p.name
                                .toLowerCase() ===
                            name.toLowerCase()
                    )
                ) {

                    sendError(
                        socket,
                        "A player with this name already exists."
                    );

                    return;

                }


                saveHistory();


                state.players.push({

                    name:
                        name,

                    status:
                        "pending",

                    team:
                        null,

                    amount:
                        0

                });


                broadcast();

            }
        );


        /*
        ================================================
        EDIT PLAYER
        ================================================
        */

        socket.on(
            "editPlayer",
            data => {

                const index =
                    Number(
                        data?.index
                    );


                const name =
                    String(
                        data?.name || ""
                    ).trim();


                if (
                    !isValidPlayerIndex(
                        index
                    )
                ) {

                    sendError(
                        socket,
                        "Invalid player."
                    );

                    return;

                }


                if (!name) {

                    sendError(
                        socket,
                        "Player name is required."
                    );

                    return;

                }


                const player =
                    state.players[
                        index
                    ];


                if (
                    player.status ===
                    "sold"
                ) {

                    sendError(
                        socket,

                        "Sold player name cannot be edited here."
                    );

                    return;

                }


                saveHistory();


                player.name =
                    name;


                broadcast();

            }
        );


        /*
        ================================================
        REMOVE PLAYER
        ================================================
        */

        socket.on(
            "removePlayer",
            index => {

                index =
                    Number(index);


                if (
                    !isValidPlayerIndex(
                        index
                    )
                ) {

                    sendError(
                        socket,
                        "Invalid player."
                    );

                    return;

                }


                const player =
                    state.players[
                        index
                    ];


                if (
                    player.status ===
                    "sold"
                ) {

                    sendError(
                        socket,

                        "Cannot delete a sold player."
                    );

                    return;

                }


                saveHistory();


                state.players.splice(
                    index,
                    1
                );


                if (
                    state.players.length ===
                    0
                ) {

                    state.current = 0;

                }

                else if (
                    state.current >=
                    state.players.length
                ) {

                    state.current =
                        state.players.length -
                        1;

                }


                broadcast();

            }
        );


        /*
        ================================================
        CORRECT SOLD PLAYER
        ================================================
        */

        socket.on(
            "editSoldPlayer",
            data => {

                const index =
                    Number(
                        data?.index
                    );


                const teamIndex =
                    Number(
                        data?.team
                    );


                const amount =
                    Number(
                        data?.amount
                    );


                if (
                    !isValidPlayerIndex(
                        index
                    )
                ) {

                    sendError(
                        socket,
                        "Invalid player."
                    );

                    return;

                }


                if (
                    !state.teams[
                        teamIndex
                    ]
                ) {

                    sendError(
                        socket,
                        "Invalid team."
                    );

                    return;

                }


                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount < 200
                ) {

                    sendError(
                        socket,
                        "Invalid price."
                    );

                    return;

                }


                const player =
                    state.players[
                        index
                    ];


                if (
                    player.status !==
                    "sold"
                ) {

                    sendError(
                        socket,
                        "Only sold players can be corrected."
                    );

                    return;

                }


                /*
                Save old state
                */

                saveHistory();


                /*
                Temporarily remove
                old sale
                */

                const oldTeam =
                    state.teams.find(
                        team =>
                            team.name ===
                            player.team
                    );


                if (oldTeam) {

                    oldTeam.spent -=
                        Number(
                            player.amount
                        ) || 0;

                }


                const newTeam =
                    state.teams[
                        teamIndex
                    ];


                /*
                Check new budget
                */

                const available =
                    newTeam.budget -
                    newTeam.spent;


                if (
                    amount >
                    available
                ) {

                    /*
                    Restore old amount
                    */

                    if (oldTeam) {

                        oldTeam.spent +=
                            Number(
                                player.amount
                            ) || 0;

                    }


                    /*
                    Remove history
                    */

                    state.history.pop();


                    sendError(
                        socket,

                        `${newTeam.name} only has ₹${available} available.`
                    );

                    return;

                }


                player.team =
                    newTeam.name;


                player.amount =
                    amount;


                newTeam.spent +=
                    amount;


                rebuildTeams();


                broadcast();

            }
        );


        /*
        ================================================
        RESET AUCTION
        ================================================
        */

        socket.on(
            "resetAuction",
            () => {

                saveHistory();


                state =
                    createDefaultState();


                saveState();


                broadcast();

            }
        );


        /*
        ================================================
        DISCONNECT
        ================================================
        */

        socket.on(
            "disconnect",
            () => {

                console.log(
                    "Client disconnected:",
                    socket.id
                );

            }
        );

    }
);


/*
========================================================
SELL PLAYER FUNCTION
========================================================
*/

function sellPlayer(
    socket,
    data
) {

    const playerIndex =
        Number(
            data?.playerIndex
        );


    const teamIndex =
        Number(
            data?.team
        );


    const amount =
        Number(
            data?.amount
        );


    /*
    -----------------------------------------------
    VALID PLAYER
    -----------------------------------------------
    */

    if (
        !isValidPlayerIndex(
            playerIndex
        )
    ) {

        sendError(
            socket,
            "Invalid player."
        );

        return;

    }


    /*
    -----------------------------------------------
    VALID TEAM
    -----------------------------------------------
    */

    if (
        !state.teams[
            teamIndex
        ]
    ) {

        sendError(
            socket,
            "Invalid team."
        );

        return;

    }


    /*
    -----------------------------------------------
    VALID PRICE
    -----------------------------------------------
    */

    if (
        !Number.isFinite(
            amount
        ) ||
        amount < 200
    ) {

        sendError(
            socket,
            "Invalid sale price."
        );

        return;

    }


    const player =
        state.players[
            playerIndex
        ];


    const team =
        state.teams[
            teamIndex
        ];


    /*
    -----------------------------------------------
    PLAYER MUST BE PENDING
    -----------------------------------------------
    */

    if (
        player.status !==
        "pending"
    ) {

        sendError(
            socket,

            "This player is already " +
            player.status +
            "."
        );

        return;

    }


    /*
    -----------------------------------------------
    BUDGET CHECK
    -----------------------------------------------
    */

    const remaining =
        team.budget -
        team.spent;


    if (
        amount >
        remaining
    ) {

        sendError(
            socket,

            `${team.name} only has ₹${remaining} remaining.`
        );

        return;

    }


    /*
    -----------------------------------------------
    SAVE HISTORY
    -----------------------------------------------
    */

    saveHistory();


    /*
    -----------------------------------------------
    UPDATE PLAYER
    -----------------------------------------------
    */

    player.status =
        "sold";


    player.team =
        team.name;


    player.amount =
        amount;


    /*
    -----------------------------------------------
    UPDATE CURRENT PLAYER
    -----------------------------------------------
    */

    state.current =
        playerIndex;


    /*
    -----------------------------------------------
    UPDATE TEAM MONEY
    -----------------------------------------------
    */

    team.spent +=
        amount;


    /*
    -----------------------------------------------
    CLEAR LIVE BID
    -----------------------------------------------
    */

    state.liveBid =
        200;


    state.liveBidTeam =
        "";


    /*
    -----------------------------------------------
    REBUILD TEAM LIST
    -----------------------------------------------
    */

    rebuildTeams();


    /*
    -----------------------------------------------
    SAVE + BROADCAST
    -----------------------------------------------
    */

    broadcast();

}


/*
========================================================
HISTORY
========================================================
*/

function saveHistory() {

    const snapshot =
        JSON.stringify(
            state
        );


    state.history.push(
        snapshot
    );


    /*
    Keep only last 30 actions
    */

    if (
        state.history.length >
        30
    ) {

        state.history.shift();

    }

}


/*
========================================================
UNDO
========================================================
*/

function undoLastAction(
    socket
) {

    if (
        !state.history ||
        state.history.length ===
        0
    ) {

        sendError(
            socket,
            "Nothing to undo."
        );

        return;

    }


    const previous =
        state.history.pop();


    try {

        const restored =
            JSON.parse(
                previous
            );


        state =
            restored;


        normalizeState();

        rebuildTeams();

        saveState();

        broadcast();

    } catch(error) {

        console.log(
            "Undo error:",
            error
        );

        sendError(
            socket,
            "Could not undo the action."
        );

    }

}


/*
========================================================
VALID PLAYER INDEX
========================================================
*/

function isValidPlayerIndex(
    index
) {

    index =
        Number(index);


    return (
        Number.isInteger(index) &&
        index >= 0 &&
        index <
            state.players.length
    );

}


/*
========================================================
ERROR MESSAGE
========================================================
*/

function sendError(
    socket,
    message
) {

    socket.emit(
        "errorMsg",
        message
    );

}


/*
========================================================
INITIAL TEAM REBUILD
========================================================
*/

rebuildTeams();

saveState();


/*
========================================================
START SERVER
========================================================
*/

server.listen(
    PORT,
    () => {

        console.log(
            "========================================"
        );

        console.log(
            "🏏 CRICKET AUCTION SERVER"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Server running at: http://localhost:${PORT}`
        );

        console.log(
            `Admin PIN: ${ADMIN_PIN}`
        );

        console.log(
            "Auction data is saved automatically."
        );

        console.log(
            "========================================"
        );

    }
);
