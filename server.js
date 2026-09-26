```javascript
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

let state = JSON.parse(
  fs.readFileSync(DATA, "utf8")
);

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
// SOCKET CONNECTION
// ==================================================

io.on("connection", (s) => {


  // Send current state
  s.emit("update", state);


  // ==================================================
  // LOGIN
  // ==================================================

  s.on("login", (data) => {

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

      adminSocketId = s.id;

      s.data.admin = true;
      s.data.adminToken = adminToken;

      s.emit("login", {

        ok: true,

        restored: true,

        token: adminToken

      });

      console.log(
        "Admin session restored."
      );

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


    // Create admin session
    adminToken =
      createAdminToken();

    adminSocketId =
      s.id;

    s.data.admin =
      true;

    s.data.adminToken =
      adminToken;


    s.emit("login", {

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

      io.emit(
        "update",
        state
      );

      io.emit(
        "nextAnimation"
      );

    }

  });


  // ==================================================
  // LIVE BID
  // ==================================================

  s.on("bid", (d) => {

    if (!isAdmin(s)) return;

    const p =
      state.players[state.current];

    const teamIndex =
      Number(d?.team);

    const amount =
      Math.max(
        200,
        Number(d?.amount) || 0
      );

    const team =
      state.teams[teamIndex];


    if (
      !p ||
      p.status !== "pending" ||
      !team
    ) {

      return;

    }


    // Check budget
    if (
      amount >
      team.budget - team.spent
    ) {

      return s.emit(
        "errorMsg",
        team.name +
        " does not have enough points."
      );

    }


    // Store current live bid
    state.liveBid =
      amount;

    state.liveBidTeam =
      teamIndex;


    save();

    io.emit(
      "update",
      state
    );

    // Bid animation
    io.emit(
      "bidAnimation"
    );

  });


  // ==================================================
  // SOLD
  // ==================================================

  s.on("sold", () => {

    if (!isAdmin(s)) return;


    const p =
      state.players[state.current];


    // IMPORTANT:
    // Use the currently selected/live team
    const teamIndex =
      Number(state.liveBidTeam);


    // IMPORTANT:
    // Use the current live bid
    const amount =
      Math.max(
        200,
        Number(state.liveBid) || 200
      );


    const team =
      state.teams[teamIndex];


    // Check player
    if (
      !p ||
      p.status !== "pending"
    ) {

      return;

    }


    // Check selected team
    if (
      !Number.isInteger(teamIndex) ||
      !team
    ) {

      return s.emit(
        "errorMsg",
        "Select a team and update the live bid first."
      );

    }


    // Check team budget
    if (
      amount >
      team.budget - team.spent
    ) {

      return s.emit(
        "errorMsg",
        team.name +
        " does not have enough points."
      );

    }


    // ==================================================
    // SAVE SALE HISTORY
    // ==================================================

    state.history.push({

      type:
        "sale",

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

    team.spent +=
      amount;


    team.players.push({

      name:
        p.name,

      amount:
        amount

    });


    // ==================================================
    // UPDATE PLAYER
    // ==================================================

    p.status =
      "sold";

    p.team =
      team.name;

    p.amount =
      amount;


    // Keep final bid visible
    state.liveBid =
      amount;

    state.liveBidTeam =
      teamIndex;


    save();


    // Send updated state
    io.emit(
      "update",
      state
    );


    // ==================================================
    // SOLD ANIMATION
    // ==================================================

    io.emit(
      "soldAnimation",
      {

        player:
          p.name,

        team:
          team.name,

        amount:
          amount

      }
    );

  });


  // ==================================================
  // UNSOLD
  // ==================================================

  s.on("unsold", () => {

    if (!isAdmin(s)) return;


    const p =
      state.players[state.current];


    if (
      !p ||
      p.status !== "pending"
    ) {

      return;

    }


    state.history.push({

      type:
        "unsold",

      playerIndex:
        state.current

    });


    p.status =
      "unsold";


    save();


    io.emit(
      "update",
      state
    );


    io.emit(
      "unsoldAnimation"
    );

  });


  // ==================================================
  // NEXT PLAYER
  // ==================================================

  s.on("next", () => {

    if (!isAdmin(s)) return;


    let n =
      state.current + 1;


    while (
      n < state.players.length &&
      state.players[n].status !== "pending"
    ) {

      n++;

    }


    if (
      n < state.players.length
    ) {

      state.current =
        n;

      state.liveBid =
        200;

      state.liveBidTeam =
        "";


      save();


      io.emit(
        "update",
        state
      );


      io.emit(
        "nextAnimation"
      );

    }

  });


  // ==================================================
  // UNDO LAST ACTION
  // ==================================================

  s.on("undoSale", () => {

    if (!isAdmin(s)) return;


    if (
      !Array.isArray(state.history) ||
      state.history.length === 0
    ) {

      return s.emit(
        "errorMsg",
        "There is no action to undo."
      );

    }


    const last =
      state.history[
        state.history.length - 1
      ];


    // ==================================================
    // UNDO SALE
    // ==================================================

    if (last.type === "sale") {

      const p =
        state.players[
          last.playerIndex
        ];

      const team =
        state.teams[
          last.teamIndex
        ];


      if (
        !p ||
        !team
      ) {

        return s.emit(
          "errorMsg",
          "Unable to undo this sale."
        );

      }


      team.spent -=
        last.amount;


      if (
        team.spent < 0
      ) {

        team.spent = 0;

      }


      const playerIndex =
        team.players.findIndex(
          x =>
            x.name === p.name &&
            Number(x.amount) ===
            Number(last.amount)
        );


      if (
        playerIndex !== -1
      ) {

        team.players.splice(
          playerIndex,
          1
        );

      }


      p.status =
        "pending";

      p.team =
        "";

      p.amount =
        0;


      state.history.pop();


      state.current =
        last.playerIndex;

      state.liveBid =
        200;

      state.liveBidTeam =
        "";


      save();


      io.emit(
        "update",
        state
      );


      io.emit(
        "undoAnimation",
        {
          player:
            p.name
        }
      );


      return;

    }


    // ==================================================
    // UNDO EDIT
    // ==================================================

    if (last.type === "edit") {

      const p =
        state.players[
          last.playerIndex
        ];

      const currentTeam =
        state.teams[
          last.newTeamIndex
        ];

      const oldTeam =
        state.teams[
          last.oldTeamIndex
        ];


      if (
        !p ||
        !currentTeam ||
        !oldTeam
      ) {

        return s.emit(
          "errorMsg",
          "Unable to undo this edit."
        );

      }


      currentTeam.spent -=
        last.newAmount;


      if (
        currentTeam.spent < 0
      ) {

        currentTeam.spent = 0;

      }


      currentTeam.players =
        currentTeam.players.filter(
          x =>
            x.name !== p.name
        );


      oldTeam.spent +=
        last.oldAmount;


      oldTeam.players.push({

        name:
          p.name,

        amount:
          last.oldAmount

      });


      p.team =
        oldTeam.name;

      p.amount =
        last.oldAmount;


      state.history.pop();


      save();


      io.emit(
        "update",
        state
      );


      io.emit(
        "undoAnimation",
        {
          player:
            p.name
        }
      );


      return;

    }


    // ==================================================
    // UNDO UNSOLD
    // ==================================================

    if (last.type === "unsold") {

      const p =
        state.players[
          last.playerIndex
        ];


      if (!p) {

        return s.emit(
          "errorMsg",
          "Unable to undo this action."
        );

      }


      p.status =
        "pending";


      state.history.pop();


      state.current =
        last.playerIndex;

      state.liveBid =
        200;

      state.liveBidTeam =
        "";


      save();


      io.emit(
        "update",
        state
      );


      io.emit(
        "undoAnimation",
        {
          player:
            p.name
        }
      );


      return;

    }


    s.emit(
      "errorMsg",
      "This action cannot be undone."
    );

  });


  // ==================================================
  // RENAME TEAM
  // ==================================================

  s.on("renameTeam", (d) => {

    if (!isAdmin(s)) return;


    const teamIndex =
      Number(
        d?.teamIndex
      );


    const newName =
      String(
        d?.newName || ""
      ).trim();


    const team =
      state.teams[
        teamIndex
      ];


    if (!team) {

      return s.emit(
        "errorMsg",
        "Invalid team."
      );

    }


    if (!newName) {

      return s.emit(
        "errorMsg",
        "Team name cannot be empty."
      );

    }


    if (
      newName.length > 30
    ) {

      return s.emit(
        "errorMsg",
        "Team name is too long."
      );

    }


    const duplicate =
      state.teams.some(
        (t, i) =>
          i !== teamIndex &&
          t.name.toLowerCase() ===
          newName.toLowerCase()
      );


    if (duplicate) {

      return s.emit(
        "errorMsg",
        "That team name already exists."
      );

    }


    const oldName =
      team.name;


    team.name =
      newName;


    // Update sold player team names
    state.players.forEach(
      player => {

        if (
          player.team ===
          oldName
        ) {

          player.team =
            newName;

        }

      }
    );


    save();


    io.emit(
      "update",
      state
    );


    io.emit(
      "successMsg",
      `Team renamed to "${newName}".`
    );

  });


  // ==================================================
  // DISCONNECT
  // ==================================================

  s.on("disconnect", () => {

    if (
      adminSocketId === s.id
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
      "Cricket Auction running on port " +
      PORT
    );

  }
);
```
