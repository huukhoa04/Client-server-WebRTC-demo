//client side for joining a room

const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomNameClient = document.getElementById('roomName_client');
const usernameClient = document.getElementById('username_client');
const chatMessagesClient = document.getElementById('chatMessages_client');
const chatInputClient = document.getElementById('chatInput_client');
const sendMessageBtnClient = document.getElementById('sendMessageBtn_client');
const remoteVideo = document.getElementById('remoteVideo');

let currentUser;
let currentRoom;
let isHost = false;
let joined = false;
let remoteStream;

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
        srConnection.on('joined', (roomName, username) => {
            console.log("joined room " + roomName + " as " + username);
            currentRoom = roomName;
            currentUser = username;
            joined = true;

            
        });
        srConnection.on('message', (username, message) => {
            console.log("Full message received:", message);
            handleMessageClient(username, message);
        });
    }).catch(err => {
        console.error('SignalR connection failed:', err);
    });
}

start();

// Event listener for disconnect button
disconnectBtn.addEventListener('click', () => {
    if (joined) {
        // Invoke the LeaveRoom method on the server
        srConnection.invoke('LeaveRoom', currentRoom, currentUser)
            .then(() => {
                console.log(`Left room: ${currentRoom}`);
                
                // Reset local variables
                currentRoom = null;
                joined = false;

                // Close peer connection
                if (peerConn) {
                    peerConn.close();
                }

                // Clear the remote video
                if (remoteVideo.srcObject) {
                    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
                    remoteVideo.srcObject = null;
                }

                // Clear the participants list
                const participantsList = document.getElementById('participantsList');
                participantsList.innerHTML = '';

                // Clear the chat messages
                chatMessagesClient.innerHTML = '';

                // Enable join button and disable disconnect button
                joinRoomBtn.disabled = false;
                disconnectBtn.disabled = true;

                console.log('Disconnected from the room');
            })
            .catch(err => {
                console.error('Error leaving room:', err);
            });
    } else {
        console.log('Not currently in a room');
    }
});


sendMessageBtnClient.addEventListener('click', () => {
    if(joined){
        const message = chatInputClient.value;
        srConnection.invoke('SendMessage', currentRoom, currentUser, { type: "chat", content: message });
        chatInputClient.value = '';
    }
    else alert("You are not in a room");
});


joinRoomBtn.addEventListener('click', () => {
    const roomName = roomNameClient.value;
    const username = usernameClient.value;
    if (roomName && username) {
        srConnection.invoke('Join', roomName, username);
    }
});

function handleMessageClient(username, message) {
    console.log("Received message from", username, ":", JSON.stringify(message, null, 2));
    switch(message.type) {
        case 'offer':
            handleOfferClient(message, username);
            break;
        case 'answer':
            handleAnswerClient(message);
            break;
        case 'candidate':
            handleCandidateClient(message.candidate);
            break;
        case 'chat':
            addMessage(username, message);
            break;
        default:
            console.warn("Unknown message type:", message.type);
    }
}

async function handleOfferClient(offer, fromUsername) {
    console.log("Received offer from", fromUsername, ":", JSON.stringify(offer, null, 2));
    try {
        if (!offer || typeof offer !== 'object') {
            throw new Error("Invalid offer received: not an object");
        }
        
        let sdp;
        if (offer.sdp && typeof offer.sdp === 'object' && offer.sdp.sdp) {
            // Handle nested SDP
            sdp = offer.sdp.sdp;
        } else if (offer.sdp && typeof offer.sdp === 'string') {
            // Handle direct SDP
            sdp = offer.sdp;
        } else {
            throw new Error("Invalid offer received: missing or invalid SDP");
        }
        
        if (sdp.trim() === '') {
            throw new Error("Invalid offer received: empty SDP");
        }
        
        console.log("SDP content:", sdp);
        await peerConn.setRemoteDescription(new RTCSessionDescription({type: 'offer', sdp: sdp}));
        const answer = await peerConn.createAnswer();
        await peerConn.setLocalDescription(answer);
        console.log("Created answer:", JSON.stringify(answer, null, 2));
        await srConnection.invoke('SendMessage', currentRoom, currentUser, {
            type: 'answer',
            sdp: answer.sdp,
            target: fromUsername
        });
    } catch (error) {
        console.error("Error handling offer:", error);
        console.error("Offer that caused the error:", JSON.stringify(offer, null, 2));
    }
}

async function handleAnswerClient(answer) {
    console.log("Received answer:", JSON.stringify(answer, null, 2));
    try {
        const currentState = peerConn.signalingState;
        console.log("Current signaling state:", currentState);

        if (currentState === 'stable') {
            console.warn("Received answer while in stable state. Ignoring.");
            return;
        }

        if (!answer || typeof answer !== 'object') {
            throw new Error("Invalid answer received: not an object");
        }

        let sdp;
        if (answer.sdp && typeof answer.sdp === 'object' && answer.sdp.sdp) {
            // Handle nested SDP
            sdp = answer.sdp.sdp;
        } else if (answer.sdp && typeof answer.sdp === 'string') {
            // Handle direct SDP
            sdp = answer.sdp;
        } else {
            throw new Error("Invalid answer received: missing or invalid SDP");
        }

        if (sdp.trim() === '') {
            throw new Error("Invalid answer received: empty SDP");
        }

        console.log("SDP content:", sdp);
        await peerConn.setRemoteDescription(new RTCSessionDescription({type: 'answer', sdp: sdp}));
        console.log("Remote description set successfully");
    } catch (error) {
        console.error("Error handling answer:", error);
        console.error("Answer that caused the error:", JSON.stringify(answer, null, 2));
    }
}

function handleCandidateClient(candidate) {
    peerConn.addIceCandidate(new RTCIceCandidate(candidate));
}

peerConn.ontrack = (event) => {
    console.log("Received track:", event);
    remoteVideo.srcObject = event.streams[0];
};

peerConn.onicecandidate = (event) => {
    if (event.candidate) {
        srConnection.invoke('SendMessage', currentRoom, currentUser, {
            type: 'candidate',
            candidate: event.candidate
        });
    }
};

function addMessage(username, message) {
    const messageElement = document.createElement('div');
    if(message.type === 'chat'){
        messageElement.classList.add('mb-2', 'p-2', 'border', 'rounded');
        messageElement.textContent = `${username}: ${message.content}`;
        chatMessagesClient.appendChild(messageElement);
        chatMessagesClient.scrollTop = chatMessagesClient.scrollHeight;
    }
}