
    let stream;
    let localStream;
    let remoteStream;
    let isInitiator = false;
    let hasRoomJoined = false;
    const activateBtn = document.getElementById('activateBtn');
    const deactivateBtn = document.getElementById('deactivateBtn');
    const screenVideo = document.getElementById('screenVideo');
    const endpointInput = document.getElementById('endpointInput');
    const qualitySelect = document.getElementById('qualitySelect');
    const remoteVideo = document.getElementById('remoteVideo');
    const joinEndpointInput = document.getElementById('joinEndpointInput');
    let myRoomId;
    let roomId;

    const configuration = {
        'iceServers': [{
          'urls': 'stun:stun.l.google.com:19302'
        }]
      };
    const peerConn = new RTCPeerConnection(configuration);


    const srConnection = new signalR.HubConnectionBuilder()
    .withUrl("http://localhost:5049/webrtc", {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
        withCredentials: true  // Add this line
    })
    .build();

    // automatically reconnect on close
    srConnection.onclose(start);

    // define (re)start function
    async function start() {
        try {
            await srConnection.start().then(() => {
                console.log("SignalR Connected.");
                srConnection.on("created", (roomId) => {
                    console.log(`Room created: ${roomId}`);
                    myRoomId = roomId;
                    hasRoomJoined = true;
                    isInitiator = true;
                });
                srConnection.on("message", (message) => {
                    console.log("Message: " + message);
                    signalingMessageCallback(message);
                });
                srConnection.on("bye", () => {
                    console.log(`Peer leaving room.`);
                });
                srConnection.on("joined", (roomId) => {
                    console.log(`Peer joined room: ${roomId}`);
                    isInitiator = false;
                    myRoomId = roomId;
                });
            
                srConnection.on("ready", () => {
                    console.log(`Socket is ready.`);
                    hasRoomJoined = true;
                    createPeerConnection(isInitiator, configuration);
                });
                srConnection.on("updateRoom", (data) => {
                    console.log("updateRoom: " + data);
                });
                srConnection.on("error", (err) => {
                    alert("error: " + err);
                });

                window.addEventListener('unload', function () {
                    if (hasRoomJoined) {
                        console.log(`Unloading window. Notifying peers in ${myRoomId}.`);
                        srConnection.invoke("LeaveRoom", myRoomId).catch(function (err) {
                            return console.error(err.toString());
                        });
                    }
                });
            });
        } catch (err) {
            console.log(err);
            setTimeout(start, 5000);
        }
    };
    

    // connect to SignalR
    start();




    const qualityConfigs = {
        high: { width: 1920, height: 1080, frameRate: 60 },
        medium: { width: 1280, height: 720, frameRate: 30 },
        low: { width: 854, height: 480, frameRate: 30 }
    };

    

    activateBtn.addEventListener('click', async () => {
        try {
            const quality = qualitySelect.value;
            const videoConstraints = {
                ...qualityConfigs[quality],
                displaySurface: 'monitor'
            };

            stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: true })
            .then(gotStream)
            .catch(err => console.error("displayMedia error:", err));
                
            
            
            // Here you can implement the logic to send the stream to your custom endpoint
            const endpoint = endpointInput.value || 'default-endpoint';
            srConnection.invoke("CreateRoom", endpoint).catch(err => console.error("Endpoint error:" + err));
            console.log(`Sending stream to endpoint: ${endpoint}`);
            console.log(`Stream quality: ${quality}`);
            // Implement your WebRTC signaling and peer connection logic here

        } catch (err) {
            console.error("Error: " + err);
        }
    });
    deactivateBtn.addEventListener('click', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            screenVideo.srcObject = null;
            activateBtn.disabled = false;
            deactivateBtn.disabled = true;

            // Implement your logic to stop the WebRTC connection here

            console.log("Screen capture deactivated");
        }
    });
    joinBtn.addEventListener('click', () => {
    if(!hasRoomJoined){
        roomId = joinEndpointInput.value;
        srConnection.invoke("Join", roomId).catch(err => console.error(err));
    }
    else alert("You are already in a room");
    });
    

    function gotStream(stream) {
        console.log('getDisplayMedia video stream URL:', stream);
        localStream = stream;
        peerConn.addStream(localStream);
        screenVideo.srcObject = stream;
        activateBtn.disabled = true;
        deactivateBtn.disabled = false;
    }




var dataChannel;

function signalingMessageCallback(message) {
    if (message.type === 'offer') {
        console.log('Got offer. Sending answer to peer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function () { },
            logError);
        peerConn.createAnswer(onLocalSessionCreated, logError);

    } else if (message.type === 'answer') {
        console.log('Got answer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function () { },
            logError);

    } else if (message.type === 'candidate') {
        peerConn.addIceCandidate(new RTCIceCandidate({
            candidate: message.candidate
        }));

    }
}
function sendMessage(message) {
    console.log('Client sending message: ', message);
    srConnection.invoke("SendMessage", myRoomId, message).catch(function (err) {
        return console.error(err.toString());
    });
}
function createPeerConnection(isInitiator, config) {
    console.log('Creating Peer connection as initiator?', isInitiator, 'config:',
        config);

    // send any ice candidates to the other peer
    peerConn.onicecandidate = function (event) {
        console.log('icecandidate event:', event);
        if (event.candidate) {
            // Trickle ICE
            //sendMessage({
            //    type: 'candidate',
            //    label: event.candidate.sdpMLineIndex,
            //    id: event.candidate.sdpMid,
            //    candidate: event.candidate.candidate
            //});
        } else {
            console.log('End of candidates.');
            // Vanilla ICE
            sendMessage(peerConn.localDescription);
        }
    };

    peerConn.ontrack = function (event) {
        console.log('icecandidate ontrack event:', event);
        remoteVideo.srcObject = event.streams[0];
    };

    if (isInitiator) {
        console.log('Creating Data Channel');
        dataChannel = peerConn.createDataChannel('sendDataChannel');
        onDataChannelCreated(dataChannel);

        console.log('Creating an offer');
        peerConn.createOffer(onLocalSessionCreated, logError);
    } else {
        peerConn.ondatachannel = function (event) {
            console.log('ondatachannel:', event.channel);
            dataChannel = event.channel;
            onDataChannelCreated(dataChannel);
        };
    }
}

function onLocalSessionCreated(desc) {
    console.log('local session created:', desc);
    peerConn.setLocalDescription(desc, function () {
        // Trickle ICE
        //console.log('sending local desc:', peerConn.localDescription);
        //sendMessage(peerConn.localDescription);
    }, logError);
}
function onDataChannelCreated(channel) {
    console.log('onDataChannelCreated on functioning...');
    console.log('onDataChannelCreated:', channel);

    channel.onopen = function () {
        console.log('Channel opened!!!');
    };

    channel.onclose = function () {
        console.log('Channel closed.');
    }

    channel.onmessage = onReceiveMessageCallback();
}
function onReceiveMessageCallback() {
    console.log('onReceiveMessageCallback on functioning...');
    let count;
    let fileSize, fileName;
    let receiveBuffer = [];

    return function onmessage(event) {
        if (typeof event.data === 'string') {
            const fileMetaInfo = event.data.split(',');
            fileSize = parseInt(fileMetaInfo[0]);
            fileName = fileMetaInfo[1];
            count = 0;
            return;
        }

        receiveBuffer.push(event.data);
        count += event.data.byteLength;

        if (fileSize === count) {
            // all data chunks have been received
            receiveBuffer = [];
            console.log('all data chunks have been received');
        }
    };
}
function logError(err) {
    if (!err) return;
    if (typeof err === 'string') {
        console.warn(err);
    } else {
        console.warn(err.toString(), err);
    }
}




