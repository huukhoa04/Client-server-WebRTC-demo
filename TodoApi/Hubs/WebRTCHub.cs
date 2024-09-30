using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TodoApi.Managers;
using TodoApi.Models;
using WebSocketSharp;

namespace TodoApi.Hubs
{
    public class WebRTCHub : Hub
    {
        private static RoomManager roomManager = new();

        public override Task OnConnectedAsync()
        {
            return base.OnConnectedAsync();
        }

        public override Task OnDisconnectedAsync(Exception exception)
        {
            roomManager.DeleteRoom(Context.ConnectionId);
            _ = NotifyRoomInfoAsync(false);
            return base.OnDisconnectedAsync(exception);
        }

        public async Task CreateRoom(string name, string username)
        {
            string userName = username.IsNullOrEmpty() ? Context.ConnectionId : username;
            RoomInfo roomInfo = roomManager.CreateRoom(userName, name);
            if (roomInfo != null)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, roomInfo.RoomID);
                await Clients.Caller.SendAsync("created", roomInfo.RoomID, userName);
                await NotifyRoomInfoAsync(false);
                // Send 'ready' event to the host
                await Clients.Caller.SendAsync("ready");
            }
            else
            {
                await Clients.Caller.SendAsync("error", "error occurred when creating a new room.");
            }
        }

        public async Task Join(string roomId, string clientName)
        {
            string userName = clientName.IsNullOrEmpty() ? Context.ConnectionId : clientName;
            await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
            await Clients.Caller.SendAsync("joined", roomId, userName);

            // Notify all clients in the room (including the host) that a new user has joined
            await Clients.Group(roomId).SendAsync("userJoined", userName);

            // Send 'ready' event to the newly joined client
            await Clients.Caller.SendAsync("ready");
        }

        public async Task LeaveRoom(string roomId, string clientName)
        {
            string userName = clientName.IsNullOrEmpty() ? Context.ConnectionId : clientName;
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
            await Clients.Group(roomId).SendAsync("bye", userName);

            // If the room is now empty, delete it

        }

        public async Task GetRoomInfo()
        {
            await NotifyRoomInfoAsync(true);
        }

        public async Task SendMessage(string roomId, string clientName, object message)
        {
            string userName = clientName.IsNullOrEmpty() ? Context.ConnectionId : clientName;
            Console.WriteLine($"Sending message: {JsonConvert.SerializeObject(message, Formatting.Indented)}");

            if (message is JObject jObject)
            {
                string? messageType = jObject["type"]?.ToString();
                string? targetClient = jObject["target"]?.ToString();

                switch (messageType)
                {
                    case "offer":
                    case "answer":
                    case "candidate":
                        if (!string.IsNullOrEmpty(targetClient))
                        {
                            await Clients.Client(targetClient).SendAsync("message", userName, message);
                        }
                        else
                        {
                            await Clients.OthersInGroup(roomId).SendAsync("message", userName, message);
                        }
                        break;
                    default:
                        await Clients.Group(roomId).SendAsync("message", userName, message);
                        break;
                }
            }
            else
            {
                await Clients.Group(roomId).SendAsync("message", userName, message);
            }
        }

        public async Task NotifyRoomInfoAsync(bool notifyOnlyCaller)
        {
            List<RoomInfo> roomInfos = roomManager.GetAllRoomInfo();
            var list = from room in roomInfos
                       select new
                       {
                           RoomId = room.RoomID,
                           Name = room.RoomName,
                           Button = "<button class=\"joinButton\">Join!</button>"
                       };
            var data = JsonConvert.SerializeObject(list);

            if (notifyOnlyCaller)
            {
                await Clients.Caller.SendAsync("updateRoom", data);
            }
            else
            {
                await Clients.All.SendAsync("updateRoom", data);
            }
        }
    }

}
