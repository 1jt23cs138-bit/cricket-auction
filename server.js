const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PIN = process.env.ADMIN_PIN || "2026";

const DATA_FILE = path.join(__dirname, "auction-data.json");
const BACKUP_FILE = path.join(__dirname, "auction-initial.json");

/* =========================================================
   LOAD DATA
========================================================= */

function readJSON(file) {
    return JSON.parse(
        fs.readFileSync(file, "utf8")
    );
}

function writeJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2)
    );
}


/* =========================================================
   CREATE ORIGINAL BACKUP ON FIRST RUN
========================================================= */

if (!fs.existsSync(BACKUP_FILE)) {

    const originalData = readJSON(DATA_FILE);

    writeJSON(
        BACKUP_FILE,
        originalData
    );

    console.log(
        "Created auction-initial.json"
    );
}


let state = readJSON(DATA_FILE);


/* =========================================================
   NORMALIZE DATA
========================================================= */

function normalizeState(data) {

    if (!data.teams) {
        data.teams = [];
    }

    if (!data.players) {
        data.players = [];
    }

    if (typeof data.current !== "number") {
        data.current = 0;
    }

    if (typeof data.liveBid !== "number") {
        data.liveBid = 200;
    }

    if (
        data.liveBidTeam === undefined ||
        data.liveBidTeam === null
    ) {
        data.liveBidTeam = "";
    }

    if (!Array.isArray(data.history)) {
        data.history = [];
    }

    data.teams.forEach(team => {

        if (typeof team.budget !== "number") {
            team.budget = 20000;
        }

        if (typeof team.spent !== "number") {
            team.spent = 0;
        }

        if (!Array.isArray(team.players)) {
            team.players = [];
        }

    });


    data.players.forEach(player => {

        if (!player.status) {
            player.status = "pending";
        }

        if (player.team === undefined) {
            player.team = "";
        }

        if (typeof player.amount !== "number") {
            player.amount = 0;
        }

    });


    return data;
}


state = normalizeState(state);

writeJSON(DATA_FILE, state);


/* =========================================================
   SAVE
========================================================= */

function save() {

    writeJSON(
        DATA_FILE,
        state
    );

}


/* =========================================================
   BROADCAST
========================================================= */

function broadcast() {

    io.emit(
        "update",
        state
    );

}


/* =========================================================
   SNAPSHOT FOR UNDO
========================================================= */

function createSnapshot() {

    return JSON.parse(
        JSON.stringify(state)
    );

}


/* =========================================================
   RESTORE SNAPSHOT
========================================================= */

function restoreSnapshot(snapshot) {

    state = normalizeState(
        JSON.parse(
            JSON.stringify(snapshot)
        )
    );

    save();
    broadcast();

}


/* =========================================================
   STATIC FILES
========================================================= */

app.use(
    express.static(__dirname)
);

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


/* =========================================================
   EXCEL DOWNLOAD
========================================================= */

app.get(
    "/download-excel",
    async (req, res) => {

        try {

            const workbook =
                new ExcelJS.Workbook();


            workbook.creator =
                "Cricket Auction System";

            workbook.created =
                new Date();


            /*
             * ONE SHEET PER TEAM
             */

            state.teams.forEach(team => {

                let sheetName =
                    team.name
                        .replace(/[\\\/\?\*\[\]\:]/g, "")
                        .substring(0, 31);

                if (!sheetName) {
                    sheetName = "Team";
                }


                const sheet =
                    workbook.addWorksheet(
                        sheetName
                    );


                /* TITLE */

                sheet.mergeCells(
                    "A1:C1"
                );

                sheet.getCell(
                    "A1"
                ).value =
                    team.name;


                sheet.getCell(
                    "A1"
                ).font = {
                    bold: true,
                    size: 18
                };


                /* SUMMARY */

                sheet.getCell(
                    "A3"
                ).value =
                    "Starting Purse";

                sheet.getCell(
                    "B3"
                ).value =
                    team.budget;


                sheet.getCell(
                    "A4"
                ).value =
                    "Total Spent";

                sheet.getCell(
                    "B4"
                ).value =
                    team.spent;


                sheet.getCell(
                    "A5"
                ).value =
                    "Remaining Purse";

                sheet.getCell(
                    "B5"
                ).value =
                    team.budget -
                    team.spent;


                sheet.getCell(
                    "A6"
                ).value =
                    "Players Bought";

                sheet.getCell(
                    "B6"
                ).value =
                    team.players.length;


                /* TABLE */

                sheet.getCell(
                    "A8"
                ).value =
                    "Player";

                sheet.getCell(
                    "B8"
                ).value =
                    "Bought Price";

                sheet.getCell(
                    "C8"
                ).value =
                    "Status";


                ["A8", "B8", "C8"]
                    .forEach(cell => {

                        sheet.getCell(
                            cell
                        ).font = {
                            bold: true
                        };

                    });


                let row = 9;


                team.players.forEach(
                    player => {

                        sheet.getCell(
                            `A${row}`
                        ).value =
                            player.name;

                        sheet.getCell(
                            `B${row}`
                        ).value =
                            player.amount;

                        sheet.getCell(
                            `C${row}`
                        ).value =
                            "SOLD";

                        row++;

                    }
                );


                /* TOTAL */

                sheet.getCell(
                    `A${row + 1}`
                ).value =
                    "TOTAL SPENT";

                sheet.getCell(
                    `B${row + 1}`
                ).value =
                    team.spent;


                sheet.getCell(
                    `A${row + 2}`
                ).value =
                    "REMAINING PURSE";

                sheet.getCell(
                    `B${row + 2}`
                ).value =
                    team.budget -
                    team.spent;


                /* WIDTH */

                sheet.getColumn(1).width =
                    28;

                sheet.getColumn(2).width =
                    18;

                sheet.getColumn(3).width =
                    15;


                /* NUMBER FORMAT */

                sheet.getColumn(2)
                    .eachCell(cell => {

                        if (
                            typeof cell.value ===
                            "number"
                        ) {

                            cell.numFmt =
                                '#,##0';

                        }

                    });

            });


            /*
             * SUMMARY SHEET
             */

            const summary =
                workbook.addWorksheet(
                    "Auction Summary"
                );


            summary.addRow([
                "CRICKET AUCTION RESULTS"
            ]);

            summary.addRow([]);

            summary.addRow([
                "Team",
                "Players",
                "Spent",
                "Remaining"
            ]);


            state.teams.forEach(
                team => {

                    summary.addRow([
                        team.name,
                        team.players.length,
                        team.spent,
                        team.budget -
                        team.spent
                    ]);

                }
            );


            summary.getColumn(1).width =
                25;

            summary.getColumn(2).width =
                15;

            summary.getColumn(3).width =
                18;

            summary.getColumn(4).width =
                18;


            const buffer =
                await workbook.xlsx.writeBuffer();


            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="Cricket_Auction_Results.xlsx"'
            );


            res.send(buffer);

        }

        catch (error) {

            console.error(
                "Excel error:",
                error
            );

            res.status(500).send(
                "Could not create Excel file."
            );

        }

    }
);


/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    "connection",
    socket => {

        console.log(
            "Connected:",
            socket.id
        );


        /*
         * SEND CURRENT STATE
         */

        socket.emit(
            "update",
            state
        );


        /* =================================================
           ADMIN LOGIN
        ================================================= */

        socket.on(
            "login",
            pin => {

                const correct =
                    String(pin) ===
                    String(PIN);


                if (correct) {

                    socket.data.admin =
                        true;

                }


                socket.emit(
                    "login",
                    correct
                );

            }
        );


        /* =================================================
           SELECT PLAYER
        ================================================= */

        socket.on(
            "select",
            index => {

                if (!socket.data.admin) {
                    return;
                }


                index = Number(index);


                if (
                    !Number.isInteger(index) ||
                    index < 0 ||
                    index >= state.players.length
                ) {

                    return;

                }


                state.current =
                    index;


                state.liveBid =
                    200;

                state.liveBidTeam =
                    "";


                save();
                broadcast();

            }
        );


        /* =================================================
           BID
        ================================================= */

        socket.on(
            "bid",
            data => {

                if (!socket.data.admin) {
                    return;
                }


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

                    socket.emit(
                        "errorMsg",
                        "This player is already completed."
                    );

                    return;

                }


                const teamIndex =
                    Number(data.team);


                const amount =
                    Number(data.amount);


                const team =
                    state.teams[
                        teamIndex
                    ];


                if (!team) {

                    socket.emit(
                        "errorMsg",
                        "Select a valid team."
                    );

                    return;

                }


                if (
                    !Number.isFinite(amount) ||
                    amount < 200
                ) {

                    socket.emit(
                        "errorMsg",
                        "Minimum bid is 200."
                    );

                    return;

                }


                const remaining =
                    team.budget -
                    team.spent;


                if (amount > remaining) {

                    socket.emit(
                        "errorMsg",
                        `${team.name} only has ${remaining} remaining.`
                    );

                    return;

                }


                state.liveBid =
                    amount;

                state.liveBidTeam =
                    teamIndex;


                save();
                broadcast();

            }
        );


        /* =================================================
           SOLD
        ================================================= */

        socket.on(
            "sold",
            () => {

                if (!socket.data.admin) {
                    return;
                }


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

                    socket.emit(
                        "errorMsg",
                        "This player is already completed."
                    );

                    return;

                }


                const teamIndex =
                    Number(
                        state.liveBidTeam
                    );


                const team =
                    state.teams[
                        teamIndex
                    ];


                if (!team) {

                    socket.emit(
                        "errorMsg",
                        "Select a winning team first."
                    );

                    return;

                }


                const amount =
                    Number(
                        state.liveBid
                    );


                const remaining =
                    team.budget -
                    team.spent;


                if (
                    amount > remaining
                ) {

                    socket.emit(
                        "errorMsg",
                        "Team does not have enough money."
                    );

                    return;

                }


                /*
                 * SAVE STATE BEFORE SALE
                 * FOR UNDO
                 */

                const beforeSale =
                    createSnapshot();


                /*
                 * UPDATE TEAM
                 */

                team.spent +=
                    amount;


                if (
                    !Array.isArray(
                        team.players
                    )
                ) {

                    team.players = [];

                }


                team.players.push({
                    name: player.name,
                    amount: amount
                });


                /*
                 * UPDATE PLAYER
                 */

                player.status =
                    "sold";

                player.team =
                    team.name;

                player.amount =
                    amount;


                /*
                 * STORE UNDO
                 */

                state.history.push({
                    type: "sale",
                    snapshot: beforeSale
                });


                /*
                 * KEEP ONLY LAST 20
                 */

                if (
                    state.history.length > 20
                ) {

                    state.history =
                        state.history.slice(-20);

                }


                save();
                broadcast();


                console.log(
                    `${player.name} SOLD to ${team.name} for ${amount}`
                );

            }
        );


        /* =================================================
           UNSOLD
        ================================================= */

        socket.on(
            "unsold",
            () => {

                if (!socket.data.admin) {
                    return;
                }


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

                    socket.emit(
                        "errorMsg",
                        "This player is already completed."
                    );

                    return;

                }


                player.status =
                    "unsold";

                player.team =
                    "";

                player.amount =
                    0;


                save();
                broadcast();

            }
        );


        /* =================================================
           NEXT PLAYER
        ================================================= */

        socket.on(
            "next",
            () => {

                if (!socket.data.admin) {
                    return;
                }


                let next =
                    state.current + 1;


                while (
                    next <
                        state.players.length &&
                    state.players[next]
                        .status !== "pending"
                ) {

                    next++;

                }


                if (
                    next >=
                    state.players.length
                ) {

                    socket.emit(
                        "errorMsg",
                        "No more available players."
                    );

                    return;

                }


                state.current =
                    next;


                state.liveBid =
                    200;

                state.liveBidTeam =
                    "";


                save();
                broadcast();

            }
        );


        /* =================================================
           ADD PLAYER
        ================================================= */

        socket.on(
            "addPlayer",
            name => {

                if (!socket.data.admin) {
                    return;
                }


                name =
                    String(
                        name || ""
                    ).trim();


                if (!name) {

                    socket.emit(
                        "errorMsg",
                        "Enter a player name."
                    );

                    return;

                }


                state.players.push({

                    name: name,

                    status: "pending",

                    team: "",

                    amount: 0

                });


                save();
                broadcast();

            }
        );


        /* =================================================
           EDIT PLAYER NAME
        ================================================= */

        socket.on(
            "editPlayer",
            data => {

                if (!socket.data.admin) {
                    return;
                }


                const index =
                    Number(data.index);


                const newName =
                    String(
                        data.name || ""
                    ).trim();


                const player =
                    state.players[
                        index
                    ];


                if (!player) {

                    socket.emit(
                        "errorMsg",
                        "Player not found."
                    );

                    return;

                }


                if (!newName) {

                    socket.emit(
                        "errorMsg",
                        "Player name cannot be empty."
                    );

                    return;

                }


                const oldName =
                    player.name;


                player.name =
                    newName;


                /*
                 * IF SOLD,
                 * UPDATE TEAM SQUAD
                 */

                if (
                    player.status === "sold" &&
                    player.team
                ) {

                    const team =
                        state.teams.find(
                            t =>
                                t.name ===
                                player.team
                        );


                    if (
                        team &&
                        Array.isArray(
                            team.players
                        )
                    ) {

                        const squad =
                            team.players.find(
                                p =>
                                    p.name ===
                                    oldName &&
                                    Number(p.amount) ===
                                    Number(player.amount)
                            );


                        if (squad) {

                            squad.name =
                                newName;

                        }

                    }

                }


                save();
                broadcast();

            }
        );


        /* =================================================
           DELETE PLAYER
        ================================================= */

        socket.on(
            "removePlayer",
            index => {

                if (!socket.data.admin) {
                    return;
                }


                index =
                    Number(index);


                const player =
                    state.players[
                        index
                    ];


                if (!player) {
                    return;
                }


                if (
                    player.status ===
                    "sold"
                ) {

                    socket.emit(
                        "errorMsg",
                        "Sold players cannot be deleted. Correct or undo the sale first."
                    );

                    return;

                }


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


                state.liveBid =
                    200;

                state.liveBidTeam =
                    "";


                save();
                broadcast();

            }
        );


        /* =================================================
           CORRECT SOLD PLAYER
        ================================================= */

        socket.on(
            "editSoldPlayer",
            data => {

                if (!socket.data.admin) {
                    return;
                }


                const index =
                    Number(data.index);


                const player =
                    state.players[
                        index
                    ];


                if (!player) {

                    socket.emit(
                        "errorMsg",
                        "Player not found."
                    );

                    return;

                }


                if (
                    player.status !==
                    "sold"
                ) {

                    socket.emit(
                        "errorMsg",
                        "Only sold players can be corrected."
                    );

                    return;

                }


                const oldTeam =
                    state.teams.find(
                        team =>
                            team.name ===
                            player.team
                    );


                const newTeamIndex =
                    Number(data.team);


                const newTeam =
                    state.teams[
                        newTeamIndex
                    ];


                const newAmount =
                    Number(data.amount);


                if (!newTeam) {

                    socket.emit(
                        "errorMsg",
                        "Select a valid team."
                    );

                    return;

                }


                if (
                    !Number.isFinite(
                        newAmount
                    ) ||
                    newAmount < 200
                ) {

                    socket.emit(
                        "errorMsg",
                        "Price must be at least 200."
                    );

                    return;

                }


                /*
                 * REMOVE OLD PURCHASE
                 */

                if (oldTeam) {

                    oldTeam.spent -=
                        Number(
                            player.amount
                        );


                    oldTeam.spent =
                        Math.max(
                            0,
                            oldTeam.spent
                        );


                    const oldIndex =
                        oldTeam.players.findIndex(
                            p =>
                                p.name ===
                                player.name &&
                                Number(p.amount) ===
                                Number(player.amount)
                        );


                    if (oldIndex !== -1) {

                        oldTeam.players.splice(
                            oldIndex,
                            1
                        );

                    }

                }


                /*
                 * CHECK NEW TEAM BUDGET
                 */

                const available =
                    newTeam.budget -
                    newTeam.spent;


                if (
                    newTeam !== oldTeam &&
                    newAmount > available
                ) {

                    /*
                     * RESTORE OLD TEAM
                     */

                    if (oldTeam) {

                        oldTeam.spent +=
                            Number(
                                player.amount
                            );


                        oldTeam.players.push({
                            name:
                                player.name,

                            amount:
                                player.amount
                        });

                    }


                    socket.emit(
                        "errorMsg",
                        `${newTeam.name} does not have enough remaining purse.`
                    );

                    return;

                }


                /*
                 * IF SAME TEAM,
                 * ACCOUNT FOR OLD PRICE
                 */

                if (
                    newTeam === oldTeam
                ) {

                    const remainingAfterRefund =
                        oldTeam.budget -
                        oldTeam.spent;


                    if (
                        newAmount >
                        remainingAfterRefund
                    ) {

                        oldTeam.spent +=
                            Number(
                                player.amount
                            );


                        oldTeam.players.push({
                            name:
                                player.name,

                            amount:
                                player.amount
                        });


                        socket.emit(
                            "errorMsg",
                            "Team does not have enough purse for this new price."
                        );

                        return;

                    }

                }


                /*
                 * ADD NEW PURCHASE
                 */

                newTeam.spent +=
                    newAmount;


                newTeam.players.push({
                    name:
                        player.name,

                    amount:
                        newAmount
                });


                /*
                 * UPDATE PLAYER
                 */

                player.team =
                    newTeam.name;

                player.amount =
                    newAmount;


                save();
                broadcast();

            }
        );


        /* =================================================
           UNDO LAST SALE
        ================================================= */

        socket.on(
            "undoSale",
            () => {

                if (!socket.data.admin) {
                    return;
                }


                if (
                    !state.history ||
                    state.history.length === 0
                ) {

                    socket.emit(
                        "errorMsg",
                        "There is no sale to undo."
                    );

                    return;

                }


                const last =
                    state.history.pop();


                if (
                    last.type !==
                    "sale"
                ) {

                    socket.emit(
                        "errorMsg",
                        "Nothing to undo."
                    );

                    return;

                }


                restoreSnapshot(
                    last.snapshot
                );

            }
        );


        /* =================================================
           RESET AUCTION
        ================================================= */

        socket.on(
            "resetAuction",
            () => {

                if (!socket.data.admin) {
                    return;
                }


                const original =
                    readJSON(
                        BACKUP_FILE
                    );


                state =
                    normalizeState(
                        original
                    );


                state.current =
                    0;

                state.liveBid =
                    200;

                state.liveBidTeam =
                    "";

                state.history =
                    [];


                save();
                broadcast();


                console.log(
                    "Auction reset."
                );

            }
        );


        /* =================================================
           DISCONNECT
        ================================================= */

        socket.on(
            "disconnect",
            () => {

                console.log(
                    "Disconnected:",
                    socket.id
                );

            }
        );

    }
);


/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            `🏏 Cricket Auction running on http://localhost:${PORT}`
        );

        console.log(
            `🔐 Admin PIN: ${PIN}`
        );

    }
);
