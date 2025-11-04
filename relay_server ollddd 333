from flask import Flask, request, jsonify
import uuid
import time

app = Flask(__name__)
rooms = {}

# Clean up old rooms periodically (optional but recommended)
ROOM_TIMEOUT = 3600  # 1 hour


@app.route("/host", methods=["POST"])
def host_session():
    room_code = str(uuid.uuid4())[:6].upper()  # 6-character room code
    rooms[room_code] = {
        "commands": [],
        "created_at": time.time()
    }
    return jsonify({"room_code": room_code})


@app.route("/send/<room_code>", methods=["POST"])
def send_command(room_code):
    if room_code not in rooms:
        return jsonify({"error": "Room not found"}), 404
    
    data = request.json
    command = data.get("command")
    index = data.get("index")
    extra_data = data.get("data")
    
    cmd_data = {"command": command}
    if index is not None:
        cmd_data["index"] = index
    if extra_data is not None:
        cmd_data["data"] = extra_data
    
    # --- THIS IS THE FIX ---
    # Add a timestamp to the command
    cmd_data["timestamp"] = time.time()
    # --- END FIX ---

    rooms[room_code]["commands"].append(cmd_data)
    print(f"📥 Room {room_code}: Stored command '{command}' with data: {extra_data is not None}")
    return jsonify({"status": "ok"})


@app.route("/receive/<room_code>", methods=["GET"])
def receive_command(room_code):
    if room_code not in rooms:
        return jsonify({"error": "Room not found"}), 404
    
    # --- THIS IS THE FIX ---
    # Get the 'since' timestamp from the client's query
    since = float(request.args.get("since", 0))
    
    # Filter commands that are newer than 'since'
    new_cmds = [cmd for cmd in rooms[room_code]["commands"] if cmd.get("timestamp", 0) > since]
    
    if new_cmds:
        print(f"📤 Room {room_code}: Sending {len(new_cmds)} command(s) since {since}")
    
    # Return the new commands AND the server's current time
    return jsonify({"commands": new_cmds, "timestamp": time.time()})
    # --- END FIX --- (Note: We no longer clear the commands list)


@app.route("/join/<room_code>", methods=["POST"])
def join_room(room_code):
    if room_code not in rooms:
        return jsonify({"error": "Room not found"}), 404
    return jsonify({"status": "joined", "room_code": room_code})


@app.route("/ping", methods=["GET"])
def ping():
    """Keep-alive endpoint."""
    return jsonify({"status": "alive", "timestamp": time.time()})


@app.route("/rooms", methods=["GET"])
def list_rooms():
    """List active rooms (for debugging)."""
    return jsonify({
        "rooms": list(rooms.keys()),
        "count": len(rooms)
    })


# Clean up old rooms
def cleanup_old_rooms():
    current_time = time.time()
    to_delete = []
    for room_code, room_data in rooms.items():
        if current_time - room_data.get("created_at", 0) > ROOM_TIMEOUT:
            to_delete.append(room_code)
    
    for room_code in to_delete:
        if room_code in rooms:
            del rooms[room_code]
            print(f"Cleaned up room: {room_code}")


@app.before_request
def before_request():
    """Run cleanup before each request."""
    # Run cleanup less frequently (e.g., 1% of requests) to save resources
    import random
    if random.random() < 0.01:
        cleanup_old_rooms()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
