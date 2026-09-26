const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const server =
  http.createServer(app);

const io =
  new Server(server);

const PORT =
  process.env.PORT || 3000;

const PIN =
  process.env.ADMIN_PIN || "1176";

const DATA =
  path.join(
    __dirname,
    "auction-data.json"
  );


/* ==================================================
   LOAD DATA
================================================== */

let state =
  JSON.parse(
    fs.readFileSync(
      DATA,
      "utf8"
    )
  );


if(
  !Array.isArray(
    state.history
  )
){

  state.history = [];

}


/* ==================================================
   SAVE
================================================== */

function save(){

  fs.writeFileSync(

    DATA,

    JSON.stringify(
      state,
      null,
      2
    )

  );

}


/* ==================================================
   WEBSITE
================================================== */

app.use(
  express.static(
    __dirname
  )
);


app.get(
  "/",
  (req,res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);


/* ==================================================
   ADMIN SECURITY
================================================== */

let adminToken = null;

let adminSocketId = null;


function createAdminToken(){

  return crypto
    .randomBytes(32)
    .toString("hex");

}


function isAdmin(socket){

  return (

    socket.data.admin === true &&

    socket.data.adminToken &&

    socket.data.adminToken ===
      adminToken &&

    socket.id ===
      adminSocketId

  );

}


/* ==================================================
   CONNECTION
================================================== */

io.on(
  "connection",
  socket => {


    /* ==============================================
       SEND CURRENT STATE
    ============================================== */

    socket.emit(
      "update",
      state
    );


    /* ==============================================
       LOGIN
    ============================================== */

    socket.on(
      "login",
      data => {

        const pin =
          String(
            data?.pin || ""
          );


        const suppliedToken =
          String(
            data?.token || ""
          );


        /* ==========================================
           RESTORE ADMIN
        ========================================== */

        if(

          suppliedToken &&

          adminToken &&

          suppliedToken ===
            adminToken

        ){

          adminSocketId =
            socket.id;

          socket.data.admin =
            true;

          socket.data.adminToken =
            adminToken;


          socket.emit(
            "login",
            {

              ok:true,

              restored:true,

              token:
                adminToken

            }
          );


          console.log(
            "Admin session restored."
          );


          return;

        }


        /* ==========================================
           ANOTHER ADMIN ALREADY ACTIVE
        ========================================== */

        if(adminToken){

          socket.emit(
            "login",
            {

              ok:false,

              message:
                "Admin is already controlling the auction."

            }
          );


          return;

        }


        /* ==========================================
           CHECK PIN
        ========================================== */

        if(pin !== PIN){

          socket.emit(
            "login",
            {

              ok:false,

              message:
                "Wrong PIN"

            }
          );


          return;

        }


        /* ==========================================
           CREATE ADMIN SESSION
        ========================================== */

        adminToken =
          createAdminToken();


        adminSocketId =
          socket.id;


        socket.data.admin =
          true;


        socket.data.adminToken =
          adminToken;


        socket.emit(
          "login",
          {

            ok:true,

            restored:false,

            token:
              adminToken

          }
        );


        console.log(
          "New Admin authorized."
        );

      }
    );


    /* ==============================================
       SELECT PLAYER
    ============================================== */

    socket.on(
      "select",
      i => {

        if(
          !isAdmin(socket)
        ){

          return;

        }


        i =
          Number(i);


        if(

          Number.isInteger(i) &&

          i >= 0 &&

          i <
            state.players.length

        ){

          state.current =
            i;


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

      }
    );


    /* ==============================================
       LIVE BID
    ============================================== */

    socket.on(
      "bid",
      data => {

        if(
          !isAdmin(socket)
        ){

          return;

        }


        const p =
          state.players[
            state.current
          ];


        const teamIndex =
          Number(
            data?.team
          );


        const amount =
          Math.max(

            200,

            Number(
              data?.amount
            ) || 0

          );


        const team =
          state.teams[
            teamIndex
          ];


        if(

          !p ||

          p.status !==
            "pending" ||

          !team

        ){

          return;

        }


        if(

          amount >
          team.budget -
          team.spent

        ){

          socket.emit(
            "errorMsg",

            team.name +
            " does not have enough points."

          );


          return;

        }


        state.liveBid =
          amount;


        state.liveBidTeam =
          teamIndex;


        save();


        io.emit(
          "update",
          state
        );


        io.emit(
          "bidAnimation"
        );

      }
    );


    /* ==============================================
       SOLD
    ============================================== */

    socket.on(
      "sold",
      data => {

        if(
          !isAdmin(socket)
        ){

          return;

        }


        const p =
          state.players[
            state.current
          ];


        /*
          SOLD uses the currently selected
          team and amount directly.
        */

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
          state.teams[
            teamIndex
          ];


        if(

          !p ||

          p.status !==
            "pending"

        ){

          return;

        }


        if(!team){

          socket.emit(
            "errorMsg",
            "Please select a team."
          );


          return;

        }


        if(

          amount >
          team.budget -
          team.spent

        ){

          socket.emit(
            "errorMsg",

            team.name +
            " does not have enough points."

          );


          return;

        }


        /* ==========================================
           HISTORY
        ========================================== */

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


        /* ==========================================
           TEAM
        ========================================== */

        team.spent +=
          amount;


        if(
          !Array.isArray(
            team.players
          )
        ){

          team.players = [];

        }


        team.players.push({

          name:
            p.name,

          amount:
            amount

        });


        /* ==========================================
           PLAYER
        ========================================== */

        p.status =
          "sold";


        p.team =
          team.name;


        p.amount =
          amount;


        state.liveBid =
          amount;


        state.liveBidTeam =
          teamIndex;


        save();


        io.emit(
          "update",
          state
        );


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

      }
    );


    /* ==============================================
       UNSOLD
    ============================================== */

    socket.on(
      "unsold",
      () => {

        if(
          !isAdmin(socket)
        ){

          return;

        }


        const p =
          state.players[
            state.current
          ];


        if(

          !p ||

          p.status !==
            "pending"

        ){

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

      }
    );


    /* ==============================================
       NEXT PLAYER
    ============================================== */

    socket.on(
      "next",
      () => {

        if(
          !isAdmin(socket)
        ){

          return;

        }


        let n =
          state.current + 1;


        while(

          n <
            state.players.length &&

          state.players[n].status !==
            "pending"

        ){

          n++;

        }


        if(
          n <
          state.players.length
        ){

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

      }
    );


    /* ==============================================
       UNDO LAST ACTION
    ============================================== */

    socket.on(
      "undoSale",
      () => {

        if(
          !isAdmin(socket)
        ){

          return;

        }


        if(

          !Array.isArray(
            state.history
          ) ||

          state.history.length === 0

        ){

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


        /* ==========================================
           UNDO SALE
        ========================================== */

        if(
          last.type ===
          "sale"
        ){

          const p =
            state.players[
              last.playerIndex
            ];


          const team =
            state.teams[
              last.teamIndex
            ];


          if(
            !p ||
            !team
          ){

            socket.emit(
              "errorMsg",

              "Unable to undo this sale."

            );


            return;

          }


          team.spent -=
            last.amount;


          if(
            team.spent < 0
          ){

            team.spent = 0;

          }


          if(
            Array.isArray(
              team.players
            )
          ){

            const playerIndex =
              team.players.findIndex(
                player =>

                  player.name ===
                    p.name &&

                  Number(
                    player.amount
                  ) ===
                    Number(
                      last.amount
                    )
              );


            if(
              playerIndex !==
              -1
            ){

              team.players.splice(
                playerIndex,
                1
              );

            }

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


        /* ==========================================
           UNDO UNSOLD
        ========================================== */

        if(
          last.type ===
          "unsold"
        ){

          const p =
            state.players[
              last.playerIndex
            ];


          if(!p){

            socket.emit(
              "errorMsg",

              "Unable to undo this action."

            );


            return;

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


        socket.emit(
          "errorMsg",

          "This action cannot be undone."

        );

      }
    );


    /* ==============================================
       RENAME TEAM
    ============================================== */

    socket.on(
      "renameTeam",
      data => {

        if(
          !isAdmin(socket)
        ){

          return;

        }


        const teamIndex =
          Number(
            data?.teamIndex
          );


        const newName =
          String(
            data?.newName || ""
          ).trim();


        const team =
          state.teams[
            teamIndex
          ];


        if(!team){

          socket.emit(
            "errorMsg",
            "Invalid team."
          );


          return;

        }


        if(!newName){

          socket.emit(
            "errorMsg",
            "Team name cannot be empty."
          );


          return;

        }


        if(
          newName.length > 30
        ){

          socket.emit(
            "errorMsg",
            "Team name is too long."
          );


          return;

        }


        const duplicate =
          state.teams.some(
            (t,index) =>

              index !==
                teamIndex &&

              t.name
                .toLowerCase() ===
              newName
                .toLowerCase()

          );


        if(duplicate){

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


        /* ==========================================
           UPDATE PLAYER TEAM NAMES
        ========================================== */

        state.players.forEach(
          player => {

            if(
              player.team ===
              oldName
            ){

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

      }
    );


    /* ==============================================
       DISCONNECT
    ============================================== */

    socket.on(
      "disconnect",
      () => {

        if(
          adminSocketId ===
          socket.id
        ){

          console.log(
            "Admin browser disconnected temporarily."
          );


          adminSocketId =
            null;

        }

      }
    );

  }
);


/* ==================================================
   START SERVER
================================================== */

server.listen(
  PORT,
  () => {

    console.log(
      "Cricket Auction running on port " +
      PORT
    );

  }
);
