/*
 From https://github.com/morgan3d/misc/

 Created by Morgan McGuire in 2020
 Released into the public domain.
*/
"use strict";

/*
 There is no consistent way to detect a closed WebRTC
 connection, so we have to send keepalive messages. PeerJS
 has its own parameters for ping rates, but does not appear
 to use them at present on investigating the code.
*/
const KEEP_ALIVE_INTERVAL_MS = 0.25 * 1000;
const KEEP_ALIVE_MESSAGE = "KEEP_ALIVE";

// How many intervals can be missed before we drop connection
const MISSABLE_INTERVALS = 10;

var remotePeerIds = []; // Crea la variabile dei peers remoti
var connections = []; // Qua è dove vengono gestite le connessioni

const peerConfig = {
  debug: 1 /*
    host: "peer.???.org",
    port: 9001,
    path: '/remoteplay',
    key: 'remoteplay'*/
};

function generateUniqueID() {
  const length = 8;
  const prefix = "xc";
  const number = (Math.random() + (performance.now() % 1000) / 1000) % 1;
  return prefix + number.toFixed(length).substring(2);
}

/* Milliseconds since epoch in UTC. Used for detecting when the last keepAlive
   was received. */
function now() {
  return new Date().getTime();
}

function startWebCam(callback) {
  console.log("startWebCam");
  if (!navigator.mediaDevices) {
    console.log("No media devices. Probably running without https");
    return;
  }

  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: { width: 512, height: 512, facingMode: "user" }
    })
    .then(callback)
    .catch(function (err) {
      console.log(err);
    });
}

/* Returns the DOM element that was added */
function addWebCamView(caption, mediaStream, playAudio, id) {
  console.log("addWebCamView for " + caption);
  const videobox = document.getElementById("videobox");
  const frame = document.createElement("div");
  frame.className = "videoFrame";
  frame.id = "_" + id;
  frame.innerHTML = `<div style="width: 100%">${caption}</div><div class="warning">⚠</div>`;
  const video = document.createElement("video");
  video.setAttribute("autoplay", true);
  // video.setAttribute('controls', true);
  video.srcObject = mediaStream;
  video.muted = !playAudio;
  frame.appendChild(video);
  videobox.appendChild(frame);

  return frame;
}

/* Write to the clipboard. Hard-coded to the specific URL box */
function clipboardCopy(text) {
  const urlTextBox = document.getElementById("urlTextBox");
  urlTextBox.select();
  urlTextBox.setSelectionRange(0, 99999);
  document.execCommand("copy");
  setTimeout(function () {
    urlTextBox.blur();
  });
}

/* Perpetually send keep alive messages to this dataConnection, and listen for them
   coming back. getVideo() is a callback because the video may not be available right
   when the data connection is. */
function keepAlive(dataConnection) {
  // Undefined until the first message comes in
  let lastTime = undefined;

  // Save the ID, which may become invalid if the connection fails
  const elementID = "_" + dataConnection.peer;

  function ping() {
    const currentTime = now();
    if (
      lastTime &&
      currentTime - lastTime > MISSABLE_INTERVALS * KEEP_ALIVE_INTERVAL_MS
    ) {
      // The other side seems to have dropped connection
      console.log(
        "lost connection. ",
        (currentTime - lastTime) / 1000,
        "seconds without a keepAlive message."
      );
      const videoElement = document.getElementById(elementID);
      if (videoElement) {
        videoElement.remove();
      }
      // Ending the iterative callback chain should allow garbage collection to occur
      // and destroy all resources
    } else {
      // console.log('sent KEEP_ALIVE message');
      dataConnection.send(KEEP_ALIVE_MESSAGE);

      // Show or hide the connection warning as appropriate. Note that the element might not exist
      // right at the beginning of the connection.
      const connectionIsBad =
        lastTime && currentTime - lastTime >= 2 * KEEP_ALIVE_INTERVAL_MS;

      const warningElement = document.querySelector(
        "#" + elementID + " .warning"
      );
      if (warningElement) {
        warningElement.style.visibility = connectionIsBad
          ? "visible"
          : "hidden";
      }

      // Schedule the next ping
      setTimeout(ping, KEEP_ALIVE_INTERVAL_MS);
    }
  }

  // Do not put these in dataConnection.on or they can fail due to a race condition
  // with initialization and never run.
  dataConnection.on("data", function (data) {
    if (data === KEEP_ALIVE_MESSAGE) {
      lastTime = now();
    }
    // console.log('received data', data);
  });

  // Start the endless keepAlive process
  ping(dataConnection);
}

function startGuest() {
  console.log("startGuest");
  const hostID = window.location.search.substring(1);
  document.getElementById(
    "urlbox"
  ).innerHTML = `tu sei il guest nella stanza ${hostID}.`;
  var guestId = generateUniqueID();
  const peer = new Peer(guestId, peerConfig);
  remotePeerIds.push(guestId);
  connections.push(peer);

  peer.on("error", function (err) {
    console.log("error in guest:", err);
  });

  peer.on("open", function (id) {
    startWebCam(function (mediaStream) {
      console.log("web cam aperta");

      addWebCamView("TU (lato guest)", mediaStream, false, id);
      // il guest risponde alla chiamata del Host
      console.log("chiama host");
      let videoElement = undefined;
      let alreadyAddedThisCall = false;

      const mediaConnection = peer.call(hostID, mediaStream);
      mediaConnection.on(
        "stream",
        function (hostStream) {
          if (!alreadyAddedThisCall) {
            alreadyAddedThisCall = true;
            console.log("Host risponde alla chiamata");
            videoElement = addWebCamView(
              "Host",
              hostStream,
              true,
              mediaConnection.peer
            );
          } else {
            console.log("elimina i duplicati");
          }
        },

        function (err) {
          console.log("host stream failed with", err);
        }
      ); //mediaConnection.on('stream')

      console.log("connect data to host");
      const dataConnection = peer.connect(hostID);
      dataConnection.on("open", function () {
        console.log("data connection to host established");
        keepAlive(dataConnection);
      });
    }); // startWebCam
  }); // peer.on('open')
}

function connettiGuestToGuest() {
  var peer = connections.slice(1);
  var id1 = remotePeerIds(1);
  // var id2 = remotePeerIds(2);
  console.log("inizializza la connessione tra i guest");
  peer.on("error", function (err) {
    console.log("errore nel Guest");
  });
  peer.on("open", function (id1) {
    startWebCam(function (mediaStream) {
      console.log("la webcam viene aperta");
      addWebCamView("Guest2", mediaStream, false, id1);
      console.log("chiama ospite ");
      // il guest 1 deve rispondere alla chiamata del guest 2
      let videoElement2 = undefined;
      let chiamatagiaAssegnata = false;
      const mediaConnection2 = peer.call(id1, mediaStream);
      mediaConnection2.on(
        "stram",
        function (guestStream) {
          if (!chiamatagiaAssegnata) {
            chiamatagiaAssegnata = true;
            console.log("il guest ha risposto");
            videoElement2 = addWebCamView(
              "altro Ospite",
              guestStream,
              true,
              mediaConnection2.peer
            );
          } else {
            console.log("elimina i duplicati");
          }
        },
        function (err) {
          console.log("lo stream con ospite fallito");
        }
      ); // media connection.on
      console.log("connessione dati con il guest");
      //quando il guest2 ha aggiunto il guest1 nella propria finestra
      //il guest1 deve aggiungere il guest2

      const dataConnection = peer.connect(id1);
      dataConnection.on("open", function () {
        console.log("connessione tra i guest stabilita");
        keepAlive(dataConnection);
      });
    }); // start webCam
  }); //peer.on(open)
}
//}

function startHost() {
  // crea una nuova connessione
  console.log("start Host");
  const id = localStorage.getItem("id") || generateUniqueID();
  localStorage.setItem("id", id);
  var peer = new Peer(id, peerConfig);
  remotePeerIds.push(id);
  connections.push(peer);
  console.log("connessione registrata");
  //Apro connessione. stampa peer id dell host
  peer.on("open", function (id) {
    console.log("My peer ID is: " + id);
    const url = "https://jennifer671.github.io/misc/jschat?" + id;
    document.getElementById(
      "urlbox"
    ).innerHTML = `Tu sei l host. Un guest puo connettersi a questo url:<br><span style="white-space:nowrap; cursor: pointer; font-weight: bold" onclick="clipboardCopy('${url}')" title="Copy to Clipboard"><input title="Copy to Clipboard" type="text" value="${url}" id="urlTextBox">&nbsp;<b style="font-size: 125%">⧉</b></span>`;
    //Inizializzo webcam
    startWebCam(function (mediaStream) {
      addWebCamView("Tu", mediaStream, false, id);
      let videoElement = undefined;
      peer.on("connection", function (dataConnection) {
        //connettiGuestToGuest();
        console.log("Connessione con il guest stabilita.");
        keepAlive(dataConnection);
      });
      peer.on(
        "call",
        function (mediaConnection) {
          console.log("Guest chiamato");
          //Rispone alla chiamata ottenendo il tuo video
          mediaConnection.answer(mediaStream);
          //chiude la chiamata se non supportato
          mediaConnection.on("close", function () {
            console.log("Il guest ha lasciato la chimata");
          });
          let chiamataGiaAggiunta = false;
          //quando il guest risponde aggiungi il suo stream
          mediaConnection.on(
            "stream",
            function (guestStream) {
              if (!chiamataGiaAggiunta) {
                chiamataGiaAggiunta = true;
                console.log("Video del guest ottenuto.");
                videoElement = addWebCamView(
                  "Ospite 1",
                  guestStream,
                  true,
                  mediaConnection.peer
                );
              } else {
                console.log("Elimina il duplicato");
              }
            },
            function (err) {
              console.log("Stream con guest fallito con err: " + err);
            }
          );
        },
        function (err) {
          console.log("la chiamata con il guest e fallita con: " + err);
        }
      ); //peer on call
    }); // start webcam
  }); //peer on Open
}

function main() {
  document.getElementById("urlbox").style.visibility = "visible";
  if (window.location.search !== "") {
    startGuest();
  } else {
    startHost();
    if (connections.length > 1) {
      connettiGuestToGuest();
    }

    // manca if per vedere se ci sono piu' guest.
  }
}
