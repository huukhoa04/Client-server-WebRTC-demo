// Selectors from WebSocket.html (host side)
const roomNameInput = document.getElementById('roomName_ws');
const usernameInput = document.getElementById('username_host');
const startStreamingBtn = document.getElementById('startStreamingBtn');
const localVideo = document.getElementById('localVideo');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

let currentUser;
let currentRoom;
let isHost = true;
let joined = false;

let peerConnections = {};
let localStream;

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
        withCredentials: true
    })
    .build();

srConnection.onclose(start);

function start() {
    srConnection.start().then(() => {
        console.log("SignalR connected");
        srConnection.on('updateRoom', function (data) {
            console.log("updateRoom", JSON.parse(data));
        });
        srConnection.on('created', (roomName, username) => {
            console.log("room created by " + username + " with room name " + roomName);
            currentRoom = roomName;
            currentUser = username;
            joined = true;
        });
        srConnection.on('message', (username, message) => {
            console.log("message from " + username + ": " + message, "type: " + message.type);
            handleMessage(username, message);
        });
        srConnection.on('userJoined', (username) => {
            console.log(`${username} joined the room`);
            addParticipant(username);
            const peerConn = createPeerConnection(username);
            createAndSendOffer(peerConn, username);
        });
        srConnection.on('bye', (username) => {
            console.log(`${username} left the room`);
            removeParticipant(username);
            // If the peer connection is still open, close it
            if (peerConn.connectionState !== 'closed') {
                peerConn.close();
            }
            // Reset the video element
            if (remoteVideo && remoteVideo.srcObject) {
                remoteVideo.srcObject.getTracks().forEach(track => track.stop());
                remoteVideo.srcObject = null;
            }
            // Optionally, you might want to create a new RTCPeerConnection here
            // if you expect new peers to join and want to be ready for them
            // peerConn = new RTCPeerConnection(configuration);
            // createp2pconnection();
        });

        
    }).catch(err => {
        console.error('SignalR connection failed:', err);
    });
}

start();


function removeParticipant(username) {
    const participantsList = document.getElementById('participantsList');
    const participants = participantsList.getElementsByTagName('li');
    for (let i = 0; i < participants.length; i++) {
        if (participants[i].textContent === username) {
            participantsList.removeChild(participants[i]);
            break;
        }
    }
}
function addParticipant(username) {
    const participantsList = document.getElementById('participantsList');
    const participantItem = document.createElement('li');
    participantItem.className = 'list-group-item';
    participantItem.textContent = username;
    participantsList.appendChild(participantItem);
}



function createp2pconnection() {
    peerConn.onicecandidate = (event) => {
        if(event.candidate){
            srConnection.invoke('SendMessage', currentRoom, currentUser, {
                type: 'candidate',
                candidate: event.candidate
            });
        }
    }
}

function handleMessage(username, message) {
    if (message.type === "answer") {
        handleAnswer(message, username);
    } else if (message.type === "candidate") {
        handleCandidate(message.candidate, username);
    } else {
        addMessage(username, message);
    }
}

function addMessage(username, message) {
    const messageElement = document.createElement('div');
    const messageContent = message.content;
    if(message.type === 'chat'){
        messageElement.classList.add('mb-2', 'p-2', 'border', 'rounded');
        messageElement.textContent = `${username}: ${messageContent}`;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function setStream(stream) {
    localVideo.srcObject = stream;
    stream.getTracks().forEach(track => {
        peerConn.addTrack(track, stream);
    });
    console.log("done setting preview");
    createAndSendOffer();
}

function createAndSendOffer(peerConn, targetClient) {
    console.log("Creating offer for", targetClient);
    peerConn.createOffer()
        .then(offer => {
            console.log("Offer created:", JSON.stringify(offer, null, 2));
            return peerConn.setLocalDescription(offer);
        })
        .then(() => {
            console.log("Local description set");
            console.log("Sending offer to", targetClient);
            return srConnection.invoke('SendMessage', currentRoom, currentUser, {
                type: 'offer',
                sdp: peerConn.localDescription.sdp,
                target: targetClient
            });
        })
        .then(() => {
            console.log("Offer sent successfully to", targetClient);
        })
        .catch(error => console.error('Error in offer creation process:', error));
}

function handleAnswer(answer, clientId) {
    const peerConn = peerConnections[clientId];
    if (peerConn) {
        peerConn.setRemoteDescription(new RTCSessionDescription(answer))
            .catch(error => console.error('Error setting remote description:', error));
    } else {
        console.error('No peer connection found for client:', clientId);
    }
}

function handleCandidate(candidate, clientId) {
    const peerConn = peerConnections[clientId];
    if (peerConn) {
        peerConn.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(error => console.error('Error adding ICE candidate:', error));
    } else {
        console.error('No peer connection found for client:', clientId);
    }
}

function getDisplayMedia() {
    navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
    })
    .then(stream => {
        localStream = stream;
        localVideo.srcObject = stream;
        // Don't call createAndSendOffer here
    })
    .catch(err => {
        console.error('Error accessing display media:', err);
    });
}

function createPeerConnection(clientId) {
    const peerConn = new RTCPeerConnection(configuration);
    peerConnections[clientId] = peerConn;

    peerConn.onicecandidate = (event) => {
        if(event.candidate){
            srConnection.invoke('SendMessage', currentRoom, currentUser, {
                type: 'candidate',
                candidate: event.candidate,
                target: clientId
            });
        }
    }

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConn.addTrack(track, localStream);
        });
    }

    return peerConn;
}

startStreamingBtn.addEventListener('click', () => {
    if(!joined){
        currentUser = usernameInput.value;
        currentRoom = roomNameInput.value;
        srConnection.invoke('CreateRoom', currentRoom, currentUser);
        joined = true;
        getDisplayMedia();
    }
    else alert("You are already in a room");
});

sendMessageBtn.addEventListener('click', () => {
    if(joined){
        const message = chatInput.value;
        srConnection.invoke('SendMessage', currentRoom, currentUser, { type: "chat", content: message });
        chatInput.value = '';
    }
    else alert("You are not in a room");
});