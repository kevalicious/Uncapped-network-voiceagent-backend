# Uncapped Network Voice Agent (Backend)

An AI-powered outbound sales calling agent for **Uncapped Network**, a fiber internet provider in Nairobi, Kenya. The backend places calls through Twilio, holds a natural conversation with the lead using OpenAI, qualifies them by service area and package interest, and streams the live conversation to a dashboard over WebSockets.

## Features

- **Outbound calling:** start a call to any lead with a single API request
- **AI sales agent ("Sarah"):** friendly, short, one-question-at-a-time conversation powered by OpenAI (GPT-4)
- **Speech-based conversation:** Twilio speech recognition for input, Amazon Polly voice for replies
- **Automatic lead qualification:** detects the lead's area (Utawala, Umoja, Mlolongo, Katani) and their interest in the Mobile, Entertainment or Business package
- **Live dashboard feed:** conversation updates are broadcast to connected frontends over WebSockets
- **Call analytics:** stats by status, qualification, area and package
- **Manual review:** mark leads as qualified or unqualified and add notes

## Tech Stack

Node.js, Express 5, Twilio (Voice), OpenAI API, ws (WebSockets), dotenv, cors, nodemon

## How It Works

1. The frontend (or any client) calls `POST /api/calls/initiate` with the lead's details.
2. Twilio dials the lead and requests `/api/voice/incoming`, where the agent greets them.
3. Each thing the lead says is transcribed by Twilio and sent to `/api/voice/process-speech`.
4. The server updates the lead info, asks OpenAI for the next reply, and speaks it back.
5. Every update is pushed to connected dashboards through the WebSocket server.
6. Twilio status callbacks (`/api/calls/status`) track call state and duration.

## Getting Started

### Prerequisites

- Node.js 18+
- A [Twilio](https://www.twilio.com/) account and a voice-enabled phone number
- An [OpenAI](https://platform.openai.com/) API key
- A public URL for Twilio webhooks (for example [ngrok](https://ngrok.com/) in development)

### Installation

```bash
git clone https://github.com/kevalicious/Uncapped-network-voiceagent-backend.git
cd Uncapped-network-voiceagent-backend
npm install
```

### Environment Variables

Create a `.env` file (never commit it):

```env
PORT=3001
BASE_URL=https://your-public-url.example.com
OPENAI_API_KEY=your_openai_api_key
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
API_KEY=a_long_random_secret
```

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (defaults to 3001) |
| `BASE_URL` | Public URL Twilio uses to reach your webhooks |
| `OPENAI_API_KEY` | OpenAI API key |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio credentials |
| `TWILIO_PHONE_NUMBER` | Twilio number calls are made from |
| `API_KEY` | Secret required in the `x-api-key` header for dashboard and call-control endpoints |

### Run

```bash
npm run dev   # development with auto-restart
npm start     # production
```

## Security

- Dashboard and call-control endpoints require an `x-api-key` header matching `API_KEY`.
- Twilio webhooks (`/api/voice/*`, `/api/calls/status`) are protected by Twilio signature validation. `BASE_URL` must exactly match the public URL configured in Twilio.
- WebSocket clients connect with `?apiKey=YOUR_KEY`.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/calls/initiate` | Start an outbound call. Body: `phoneNumber`, `leadName`, `leadInfo` |
| POST | `/api/voice/incoming` | Twilio webhook: greeting and first prompt |
| POST | `/api/voice/process-speech` | Twilio webhook: handles speech and returns the AI reply |
| POST | `/api/calls/status` | Twilio call status callback |
| GET | `/api/conversations` | List all conversations |
| GET | `/api/conversations/:callSid` | Get one conversation |
| POST | `/api/conversations/:callSid/qualify` | Set qualification and add notes. Body: `qualified`, `notes` |
| GET | `/api/stats` | Totals plus breakdowns by area and package |

### Example

```bash
curl -X POST http://localhost:3001/api/calls/initiate \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"phoneNumber": "+2547XXXXXXXX", "leadName": "Jane", "leadInfo": {}}'
```

### WebSocket

Connect a client to the server's WebSocket endpoint to receive live updates:

```json
{ "type": "conversation_update", "callSid": "CA...", "data": { } }
```

## Known Limitations

- Conversations are stored in memory and are lost when the server restarts
- Lead qualification relies on simple keyword matching

## Roadmap

- [ ] Persist conversations in a database
- [ ] Per-user authentication and rate limiting
- [ ] Smarter intent and area detection
- [ ] Add automated tests

## License

ISC
