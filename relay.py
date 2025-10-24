from flask import Flask, request, jsonify
import uuid

app = Flask(__name__)
rooms = {}

@app.route("/host", methods=["POST"])
def host_session():
    room_code = str(uuid.uuid4())[:4]  # generate a 4-digit room code
    rooms[room_code] = {"commands": []}
    return jsonify({"room_code": room_code})

@app.route("/send/<room_code>", methods=["POST"])
def send_command(room_code):
    if room_code not in rooms:
        return jsonify({"error": "Room not found"}), 404
    data = request.json
    rooms[room_code]["commands"].append(data["command"])
    return jsonify({"status": "ok"})

@app.route("/receive/<room_code>", methods=["GET"])
def receive_command(room_code):
    if room_code not in rooms:
        return jsonify({"error": "Room not found"}), 404
    cmds = rooms[room_code]["commands"]
    rooms[room_code]["commands"] = []  # clear after sending
    return jsonify({"commands": cmds})


@app.route("/join/<room_code>", methods=["POST"])
def join_room(room_code):
    if room_code not in rooms:
        return jsonify({"error": "Room not found"}), 404
    return jsonify({"status": "joined", "room_code": room_code})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
