const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PIN = process.env.ADMIN_PIN || "1176";

const DATA = path.join(__dirname, "auction-data.json");

// ==================================================
// LOAD DATA
// ==================================================

let state;

try {
  state = JSON.parse(fs.readFileSync(DATA, "utf8"));
} catch (error) {
  console.error("Unable to load auction-data.json:", error);
  process.exit(1);
}

if (!Array.isArray(state.players)) {
  state.players = [];
}

if (!Array.isArray(state.teams)) {
  state.teams = [];
}

if (!Array.isArray(state.history)) {
  state.history = [];
}

if (!Number.isInteger(state.current)) {
  state.current = 0;
}

if (typeof state.liveBid !== "number") {
  state.liveBid = 200;
}

if (
  state.liveBidTeam === undefined ||
  state.liveBidTeam === null
) {
  state.liveBidTeam = "";
}


// ==================================================
// SAVE
// ==================================================

function save() {
  try {
    fs.writeFileSync(
      DATA,
      JSON.stringify(state, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Save error:", error);
  }
}


// ==================================================
// WEBSITE
// ==================================================

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});


// ==================================================
// ADMIN SECURITY
// ==================================================

let adminToken = null;
let adminSocketId = null;

function createAdminToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function isAdmin(socket) {
  return (
    socket.data.admin === true &&
    socket.data.adminToken &&
    socket.data.adminToken === adminToken &&
    socket.id === adminSocketId
  );
}


// ==================================================
// CONNECTION
// ==================================================

io.on("connection", (socket) => {

  // Send current state
  socket.emit("update", state);


  // ==================================================
  // LOGIN
  // ==================================================

  socket.on("login", (data) => {

    const pin =
      String(data?.pin || "");

    const suppliedToken =
      String(data?.token || "");


    // Restore existing admin session
    if (
      suppliedToken &&
      adminToken &&
      suppliedToken === adminToken
    ) {

      adminSocketId = socket.id;

      socket.data.admin = true;
      socket.data.adminToken = adminToken;

      socket.emit("login", {
        ok: true,
        restored: true,
        token: adminToken
      });

      console.log(
        "Admin session restored."
      );

      return;
    }


    // Another admin already active
    if (adminToken) {

      socket.emit("login", {
        ok: false,
        message:
          "Admin is already controlling the auction."
      });

      return;
    }


    // Check PIN
    if (pin !== PIN) {

      socket.emit("login", {
        ok: false,
        message: "Wrong Admin PIN."
      });

      return;
    }


    // Create new admin session
    adminToken =
      createAdminToken();

    adminSocketId =
      socket.id;

    socket.data.admin = true;
    socket.data.adminToken = adminToken;

    socket.emit("login", {
      ok: true,
      restored: false,
      token: adminToken
    });

    console.log(
      "New Admin authorized."
    );
  });


  // ==================================================
  // SELECT PLAYER
  // ==================================================

  socket.on("select", (index) => {

    if (!isAdmin(socket)) return;

    index = Number(index);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= state.players.length
    ) {
      return;
    }

    state.current = index;

    state.liveBid = 200;
    state.liveBidTeam = "";

    save();

    io.emit("update", state);
    io.emit("nextAnimation");
  });


  // ==================================================
  // LIVE BID
  // ==================================================

  socket.on("bid", (data) => {

    if (!isAdmin(socket)) return;

    const player =
      state.players[state.current];

    const teamIndex =
      Number(data?.team);

    const amount =
      Math.max(
        200,
        Number(data?.amount) || 0
      );

    const team =
      state.teams[teamIndex];


    if (
      !player ||
      player.status !== "pending" ||
      !team
    ) {
      return;
    }


    const remaining =
      team.budget - team.spent;


    if (amount > remaining) {

      socket.emit(
        "errorMsg",
        `${team.name} does not have enough points.`
      );

      return;
    }


    state.liveBid =
      amount;

    state.liveBidTeam =
      teamIndex;


    save();

    io.emit("update", state);

    io.emit("bidAnimation");
  });


  // ==================================================
  // SOLD
  // ==================================================

  socket.on("sold", (data) => {

    if (!isAdmin(socket)) return;

    const player =
      state.players[state.current];


    // IMPORTANT:
    // SOLD uses the currently selected
    // team and current bid.
    const teamIndex =
      Number(
        data?.team ??
        state.liveBidTeam
      );


    const amount =
      Math.max(
        200,
        Number(
          data?.amount ??
          state.liveBid
        ) || 0
      );


    const team =
      state.teams[teamIndex];


    if (
      !player ||
      player.status !== "pending"
    ) {
      return;
    }


    if (!team) {

      socket.emit(
        "errorMsg",
        "Please select a team first."
      );

      return;
    }


    const remaining =
      team.budget - team.spent;


    if (amount > remaining) {

      socket.emit(
        "errorMsg",
        `${team.name} does not have enough points.`
      );

      return;
    }


    // ==================================================
    // SAVE SALE HISTORY
    // ==================================================

    state.history.push({

      type: "sale",

      playerIndex:
        state.current,

      teamIndex:
        teamIndex,

      amount:
        amount
    });


    // ==================================================
    // UPDATE TEAM
    // ==================================================

    team.spent += amount;

    team.players.push({

      name:
        player.name,

      amount:
        amount
    });


    // ==================================================
    // UPDATE PLAYER
    // ==================================================

    player.status =
      "sold";

    player.team =
      team.name;

    player.amount =
      amount;


    state.liveBid =
      amount;

    state.liveBidTeam =
      teamIndex;


    save();

    io.emit("update", state);


    // Animation
    io.emit("soldAnimation", {

      player:
        player.name,

      team:
        team.name,

      amount:
        amount
    });

  });


  // ==================================================
  // UNSOLD
  // ==================================================

  socket.on("unsold", () => {

    if (!isAdmin(socket)) return;

    const player =
      state.players[state.current];


    if (
      !player ||
      player.status !== "pending"
    ) {
      return;
    }


    state.history.push({

      type:
        "unsold",

      playerIndex:
        state.current
    });


    player.status =
      "unsold";

    player.team =
      "";

    player.amount =
      0;


    save();

    io.emit("update", state);
    io.emit("unsoldAnimation");
  });


  // ==================================================
  // NEXT PLAYER
  // ==================================================

  socket.on("next", () => {

    if (!isAdmin(socket)) return;

    let nextIndex =
      state.current + 1;


    while (
      nextIndex < state.players.length &&
      state.players[nextIndex].status !== "pending"
    ) {

      nextIndex++;
    }


    if (
      nextIndex >= state.players.length
    ) {

      socket.emit(
        "errorMsg",
        "There are no more pending players."
      );

      return;
    }


    state.current =
      nextIndex;

    state.liveBid =
      200;

    state.liveBidTeam =
      "";


    save();

    io.emit("update", state);
    io.emit("nextAnimation");
  });


  // ==================================================
  // UNDO LAST ACTION
  // ==================================================

  socket.on("undoSale", () => {

    if (!isAdmin(socket)) return;


    if (
      !Array.isArray(state.history) ||
      state.history.length === 0
    ) {

      socket.emit(
        "errorMsg",
        "There is no action to undo."
      );

      return;
    }


    const last =
      state.history[
        state.history.length - 1
      ];


    // ==================================================
    // UNDO SALE
    // ==================================================

    if (last.type === "sale") {

      const player =
        state.players[
          last.playerIndex
        ];

      const team =
        state.teams[
          last.teamIndex
        ];


      if (!player || !team) {

        socket.emit(
          "errorMsg",
          "Unable to undo this sale."
        );

        return;
      }


      team.spent -=
        last.amount;


      if (team.spent < 0) {
        team.spent = 0;
      }


      const playerIndex =
        team.players.findIndex(
          x =>
            x.name === player.name &&
            Number(x.amount) ===
            Number(last.amount)
        );


      if (playerIndex !== -1) {

        team.players.splice(
          playerIndex,
          1
        );
      }


      player.status =
        "pending";

      player.team =
        "";

      player.amount =
        0;


      state.history.pop();


      state.current =
        last.playerIndex;

      state.liveBid =
        200;

      state.liveBidTeam =
        "";


      save();

      io.emit("update", state);

      io.emit(
        "undoAnimation",
        {
          player:
            player.name
        }
      );

      return;
    }


    // ==================================================
    // UNDO EDIT
    // ==================================================

    if (last.type === "edit") {

      const player =
        state.players[
          last.playerIndex
        ];

      const newTeam =
        state.teams[
          last.newTeamIndex
        ];

      const oldTeam =
        state.teams[
          last.oldTeamIndex
        ];


      if (
        !player ||
        !newTeam ||
        !oldTeam
      ) {

        socket.emit(
          "errorMsg",
          "Unable to undo this edit."
        );

        return;
      }


      newTeam.spent -=
        last.newAmount;


      if (newTeam.spent < 0) {
        newTeam.spent = 0;
      }


      newTeam.players =
        newTeam.players.filter(
          x =>
            x.name !== player.name
        );


      oldTeam.spent +=
        last.oldAmount;


      oldTeam.players.push({

        name:
          player.name,

        amount:
          last.oldAmount
      });


      player.team =
        oldTeam.name;

      player.amount =
        last.oldAmount;


      state.history.pop();

      save();

      io.emit("update", state);

      io.emit(
        "undoAnimation",
        {
          player:
            player.name
        }
      );

      return;
    }


    // ==================================================
    // UNDO UNSOLD
    // ==================================================

    if (last.type === "unsold") {

      const player =
        state.players[
          last.playerIndex
        ];


      if (!player) {

        socket.emit(
          "errorMsg",
          "Unable to undo this action."
        );

        return;
      }


      player.status =
        "pending";


      state.history.pop();


      state.current =
        last.playerIndex;

      state.liveBid =
        200;

      state.liveBidTeam =
        "";


      save();

      io.emit("update", state);

      io.emit(
        "undoAnimation",
        {
          player:
            player.name
        }
      );

      return;
    }


    socket.emit(
      "errorMsg",
      "This action cannot be undone."
    );
  });


  // ==================================================
  // EDIT SOLD PLAYER
  // ==================================================

  socket.on("editSale", (data) => {

    if (!isAdmin(socket)) return;


    const playerIndex =
      Number(data?.playerIndex);

    const newTeamIndex =
      Number(data?.teamIndex);

    const newAmount =
      Math.max(
        200,
        Number(data?.amount) || 0
      );


    const player =
      state.players[playerIndex];

    const newTeam =
      state.teams[newTeamIndex];


    if (!player || !newTeam) {

      socket.emit(
        "errorMsg",
        "Invalid player or team."
      );

      return;
    }


    if (player.status !== "sold") {

      socket.emit(
        "errorMsg",
        "Only sold players can be edited."
      );

      return;
    }


    const oldTeamIndex =
      state.teams.findIndex(
        team =>
          team.name === player.team
      );


    if (oldTeamIndex === -1) {

      socket.emit(
        "errorMsg",
        "Original team not found."
      );

      return;
    }


    const oldTeam =
      state.teams[oldTeamIndex];

    const oldAmount =
      Number(player.amount) || 0;


    // Same team
    if (
      oldTeamIndex ===
      newTeamIndex
    ) {

      const finalSpent =
        oldTeam.spent -
        oldAmount +
        newAmount;


      if (
        finalSpent >
        oldTeam.budget
      ) {

        socket.emit(
          "errorMsg",
          "Team does not have enough points."
        );

        return;
      }
    }

    // Different team
    else {

      if (
        newTeam.spent +
        newAmount >
        newTeam.budget
      ) {

        socket.emit(
          "errorMsg",
          `${newTeam.name} does not have enough points.`
        );

        return;
      }
    }


    // Save edit history
    state.history.push({

      type:
        "edit",

      playerIndex:
        playerIndex,

      oldTeamIndex:
        oldTeamIndex,

      oldAmount:
        oldAmount,

      newTeamIndex:
        newTeamIndex,

      newAmount:
        newAmount
    });


    // Remove old team
    oldTeam.spent -=
      oldAmount;

    if (oldTeam.spent < 0) {
      oldTeam.spent = 0;
    }


    oldTeam.players =
      oldTeam.players.filter(
        x =>
          x.name !== player.name
      );


    // Add new team
    newTeam.spent +=
      newAmount;

    newTeam.players.push({

      name:
        player.name,

      amount:
        newAmount
    });


    // Update player
    player.team =
      newTeam.name;

    player.amount =
      newAmount;


    save();

    io.emit("update", state);

    io.emit(
      "editAnimation",
      {
        player:
          player.name
      }
    );
  });


  // ==================================================
  // RENAME TEAM
  // ==================================================

  socket.on("renameTeam", (data) => {

    if (!isAdmin(socket)) return;


    const teamIndex =
      Number(data?.teamIndex);

    const newName =
      String(
        data?.newName || ""
      ).trim();


    const team =
      state.teams[teamIndex];


    if (!team) {

      socket.emit(
        "errorMsg",
        "Invalid team."
      );

      return;
    }


    if (!newName) {

      socket.emit(
        "errorMsg",
        "Team name cannot be empty."
      );

      return;
    }


    if (newName.length > 30) {

      socket.emit(
        "errorMsg",
        "Team name is too long."
      );

      return;
    }


    const duplicate =
      state.teams.some(
        (t, index) =>
          index !== teamIndex &&
          t.name.toLowerCase() ===
          newName.toLowerCase()
      );


    if (duplicate) {

      socket.emit(
        "errorMsg",
        "That team name already exists."
      );

      return;
    }


    const oldName =
      team.name;


    team.name =
      newName;


    // Update sold players
    state.players.forEach(
      player => {

        if (
          player.team === oldName
        ) {

          player.team =
            newName;
        }
      }
    );


    save();

    io.emit("update", state);

    io.emit(
      "successMsg",
      `Team renamed to "${newName}".`
    );
  });


  // ==================================================
  // DISCONNECT
  // ==================================================

  socket.on("disconnect", () => {

    if (
      adminSocketId === socket.id
    ) {

      console.log(
        "Admin browser disconnected temporarily."
      );

      adminSocketId = null;
    }
  });

});


// ==================================================
// START SERVER
// ==================================================

server.listen(
  PORT,
  () => {

    console.log(
      `Cricket Auction running on port ${PORT}`
    );
  }
);
