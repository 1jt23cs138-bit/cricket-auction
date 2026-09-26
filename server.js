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

let state = JSON.parse(fs.readFileSync(DATA, "utf8"));


// Make sure history exists
if (!Array.isArray(state.history)) {
  state.history = [];
}


// ==================================================
// SAVE
// ==================================================

function save() {
  fs.writeFileSync(
    DATA,
    JSON.stringify(state, null, 2)
  );
}


// ==================================================
// WEBSITE
// ==================================================

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ==================================================
// ADMIN SECURITY
// ==================================================

let adminToken = null;
let adminSocketId = null;


function createAdminToken() {
  return crypto.randomBytes(32).toString("hex");
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
// SOCKET CONNECTION
// ==================================================

io.on("connection", (s) => {

  // Send current state
  s.emit("update", state);


  // =================================================
  // LOGIN
  // =================================================

  s.on("login", (data) => {

    const pin = String(data?.pin || "");
    const suppliedToken = String(data?.token || "");


    // Existing admin browser reconnect
    if (
      suppliedToken &&
      adminToken &&
      suppliedToken === adminToken
    ) {

      adminSocketId = s.id;

      s.data.admin = true;
      s.data.adminToken = adminToken;

      s.emit("login", {
        ok: true,
        restored: true,
        token: adminToken
      });

      console.log("Admin session restored");

      return;
    }


    // Another browser cannot become admin
    if (adminToken) {

      s.emit("login", {
        ok: false,
        message:
          "Admin is already controlling the auction."
      });

      return;
    }


    // Check PIN
    if (pin !== PIN) {

      s.emit("login", {
        ok: false,
        message: "Wrong PIN"
      });

      return;
    }


    // Create admin token
    adminToken = createAdminToken();

    adminSocketId = s.id;

    s.data.admin = true;
    s.data.adminToken = adminToken;


    s.emit("login", {
      ok: true,
      restored: false,
      token: adminToken
    });


    console.log("New Admin authorized");
  });


  // =================================================
  // SELECT PLAYER
  // =================================================

  s.on("select", (i) => {

    if (!isAdmin(s)) return;

    i = Number(i);

    if (
      Number.isInteger(i) &&
      i >= 0 &&
      i < state.players.length
    ) {

      state.current = i;

      state.liveBid = 200;
      state.liveBidTeam = "";

      save();

      io.emit("update", state);
    }
  });


  // =================================================
  // LIVE BID
  // =================================================

  s.on("bid", (d) => {

    if (!isAdmin(s)) return;

    const p = state.players[state.current];

    const ti = Number(d?.team);

    const a = Math.max(
      200,
      Number(d?.amount) || 0
    );

    const t = state.teams[ti];


    if (!p || p.status !== "pending" || !t) {
      return;
    }


    if (a > t.budget - t.spent) {

      return s.emit(
        "errorMsg",
        t.name + " does not have enough points."
      );
    }


    state.liveBid = a;
    state.liveBidTeam = ti;

    save();

    io.emit("update", state);
  });


  // =================================================
  // SOLD
  // =================================================

  s.on("sold", (d) => {

    if (!isAdmin(s)) return;

    const p = state.players[state.current];

    const ti = Number(
      d?.team ?? state.liveBidTeam
    );

    const a = Math.max(
      200,
      Number(d?.amount ?? state.liveBid) || 0
    );

    const t = state.teams[ti];


    if (!p || p.status !== "pending") {
      return;
    }


    if (!t) {

      return s.emit(
        "errorMsg",
        "Select a winning team first."
      );
    }


    if (a > t.budget - t.spent) {

      return s.emit(
        "errorMsg",
        "Team does not have enough points."
      );
    }


    // Save last sale for UNDO
    state.history.push({
      type: "sale",
      playerIndex: state.current,
      teamIndex: ti,
      amount: a
    });


    // Team spending
    t.spent += a;

    t.players.push({
      name: p.name,
      amount: a
    });


    // Player data
    p.status = "sold";
    p.team = t.name;
    p.amount = a;


    state.liveBid = a;
    state.liveBidTeam = ti;


    save();

    io.emit("update", state);

    io.emit("saleAnimation", {
      player: p.name,
      team: t.name,
      amount: a
    });
  });


  // =================================================
  // UNSOLD
  // =================================================

  s.on("unsold", () => {

    if (!isAdmin(s)) return;

    const p = state.players[state.current];


    if (!p || p.status !== "pending") {
      return;
    }


    p.status = "unsold";

    save();

    io.emit("update", state);
  });


  // =================================================
  // NEXT PLAYER
  // =================================================

  s.on("next", () => {

    if (!isAdmin(s)) return;

    let n = state.current + 1;


    while (
      n < state.players.length &&
      state.players[n].status !== "pending"
    ) {
      n++;
    }


    if (n < state.players.length) {

      state.current = n;

      state.liveBid = 200;
      state.liveBidTeam = "";

      save();

      io.emit("update", state);
    }
  });


  // =================================================
  // UNDO LAST SALE
  // =================================================

  s.on("undoLastSale", () => {

    if (!isAdmin(s)) return;


    if (
      !Array.isArray(state.history) ||
      state.history.length === 0
    ) {

      return s.emit(
        "errorMsg",
        "There is no sale to undo."
      );
    }


    const last =
      state.history[state.history.length - 1];


    if (last.type !== "sale") {

      return s.emit(
        "errorMsg",
        "The last action cannot be undone."
      );
    }


    const p =
      state.players[last.playerIndex];

    const t =
      state.teams[last.teamIndex];


    if (!p || !t) {

      return s.emit(
        "errorMsg",
        "Unable to undo this sale."
      );
    }


    // Return points
    t.spent -= last.amount;

    if (t.spent < 0) {
      t.spent = 0;
    }


    // Remove player from team
    const playerIndex =
      t.players.findIndex(
        x => x.name === p.name &&
             Number(x.amount) === Number(last.amount)
      );


    if (playerIndex !== -1) {
      t.players.splice(playerIndex, 1);
    }


    // Reset player
    p.status = "pending";
    p.team = "";
    p.amount = 0;


    // Remove history
    state.history.pop();


    // Select that player again
    state.current = last.playerIndex;

    state.liveBid = 200;
    state.liveBidTeam = "";


    save();

    io.emit("update", state);

    io.emit("undoAnimation", {
      player: p.name
    });
  });


  // =================================================
  // EDIT SOLD PLAYER
  // =================================================

  s.on("editSale", (d) => {

    if (!isAdmin(s)) return;


    const playerIndex =
      Number(d?.playerIndex);

    const newTeamIndex =
      Number(d?.team);

    const newAmount =
      Math.max(
        200,
        Number(d?.amount) || 0
      );


    const p =
      state.players[playerIndex];

    const newTeam =
      state.teams[newTeamIndex];


    if (!p || !newTeam) {

      return s.emit(
        "errorMsg",
        "Invalid player or team."
      );
    }


    if (p.status !== "sold") {

      return s.emit(
        "errorMsg",
        "Only sold players can be edited."
      );
    }


    // Find old team
    const oldTeamIndex =
      state.teams.findIndex(
        t => t.name === p.team
      );


    if (oldTeamIndex === -1) {

      return s.emit(
        "errorMsg",
        "Original team not found."
      );
    }


    const oldTeam =
      state.teams[oldTeamIndex];


    const oldAmount =
      Number(p.amount) || 0;


    // If same team
    if (oldTeamIndex === newTeamIndex) {

      const difference =
        newAmount - oldAmount;


      if (
        newTeam.spent + difference >
        newTeam.budget
      ) {

        return s.emit(
          "errorMsg",
          "Team does not have enough points."
        );
      }


      newTeam.spent += difference;


      const tp =
        newTeam.players.find(
          x => x.name === p.name
        );


      if (tp) {
        tp.amount = newAmount;
      }


      p.amount = newAmount;
      p.team = newTeam.name;
    }


    // Changing team
    else {

      // Check new team money
      if (
        newTeam.spent + newAmount >
        newTeam.budget
      ) {

        return s.emit(
          "errorMsg",
          newTeam.name +
          " does not have enough points."
        );
      }


      // Remove from old team
      oldTeam.spent -= oldAmount;

      if (oldTeam.spent < 0) {
        oldTeam.spent = 0;
      }


      oldTeam.players =
        oldTeam.players.filter(
          x => x.name !== p.name
        );


      // Add to new team
      newTeam.spent += newAmount;

      newTeam.players.push({
        name: p.name,
        amount: newAmount
      });


      // Update player
      p.team = newTeam.name;
      p.amount = newAmount;
    }


    save();

    io.emit("update", state);

    io.emit("editAnimation", {
      player: p.name
    });
  });


  // =================================================
  // DISCONNECT
  // =================================================

  s.on("disconnect", () => {

    // Do NOT destroy admin token.
    // This allows refresh/reconnect.

    if (adminSocketId === s.id) {

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

server.listen(PORT, () => {

  console.log(
    "Cricket Auction running on port " +
    PORT
  );

});
