// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const WebSocket = require('ws');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store active calls and conversations
const activeCalls = new Map();
const conversations = new Map();

// Service areas in Nairobi
const SERVICE_AREAS = ['Utawala', 'Umoja', 'Mlolongo', 'Katani'];

// Internet packages
const PACKAGES = {
  mobile: {
    name: 'Mobile',
    price: 1499,
    speed: '6Mbps',
    features: ['Line Rental Included', 'No Activation Charges', 'Up to 6Mbps average Speed']
  },
  entertainment: {
    name: 'Entertainment',
    price: 1999,
    speed: '12Mbps',
    features: ['Line Rental Included', 'No Activation Charges', 'Up to 12Mbps average Speed', 'Enjoy family on weekends']
  },
  business: {
    name: 'Business',
    price: 2499,
    speed: '20Mbps',
    features: ['Line Rental Included', 'No Activation Charges', 'Up to 20Mbps average Speed', 'Enjoy family on weekends']
  }
};

// WebSocket server for real-time updates
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Frontend connected via WebSocket');
  
  ws.on('close', () => {
    console.log('Frontend disconnected');
  });
});

// Broadcast conversation updates to all connected clients
function broadcastConversation(callSid, update) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'conversation_update',
        callSid,
        data: update
      }));
    }
  });
}

// Initiate outbound call
app.post('/api/calls/initiate', async (req, res) => {
  try {
    const { phoneNumber, leadName, leadInfo } = req.body;

    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/api/voice/incoming`,
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
      statusCallback: `${process.env.BASE_URL}/api/calls/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    // Initialize conversation storage
    conversations.set(call.sid, {
      callSid: call.sid,
      phoneNumber,
      leadName,
      leadInfo: {
        ...leadInfo,
        location: '',
        currentProvider: '',
        interestedPackage: '',
        currentSpeed: ''
      },
      status: 'initiated',
      messages: [],
      startTime: new Date(),
      qualified: null,
      notes: [],
      serviceableArea: null
    });

    activeCalls.set(call.sid, {
      phoneNumber,
      leadName,
      leadInfo,
      conversation: []
    });

    res.json({
      success: true,
      callSid: call.sid,
      message: 'Call initiated successfully'
    });
  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle incoming voice webhook
app.post('/api/voice/incoming', (req, res) => {
  const callSid = req.body.CallSid;
  const twiml = new twilio.twiml.VoiceResponse();

  const callData = activeCalls.get(callSid);
  const leadName = callData?.leadName || 'there';

  // Initial greeting
  twiml.say({
    voice: 'Polly.Joanna',
    language: 'en-US'
  }, `Hello ${leadName}! This is Sarah from Uncapped Network, Kenya's reliable fiber internet provider. I'm calling to see if you'd be interested in high-speed fiber internet for your home or business. Are you currently in Nairobi?`);

  // Start gathering input
  twiml.gather({
    input: 'speech',
    action: `/api/voice/process-speech?callSid=${callSid}`,
    speechTimeout: 'auto',
    speechModel: 'phone_call',
    language: 'en-US'
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// Process speech input and generate AI response
app.post('/api/voice/process-speech', async (req, res) => {
  const { SpeechResult, CallSid } = req.body;
  const callSid = req.query.callSid || CallSid;
  
  const twiml = new twilio.twiml.VoiceResponse();

  if (!SpeechResult) {
    twiml.say('I didn\'t catch that. Could you please repeat?');
    twiml.gather({
      input: 'speech',
      action: `/api/voice/process-speech?callSid=${callSid}`,
      speechTimeout: 'auto',
      language: 'en-US'
    });
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  try {
    const callData = activeCalls.get(callSid);
    const conversation = callData?.conversation || [];

    // Add user message
    conversation.push({
      role: 'user',
      content: SpeechResult
    });

    // Update conversation storage
    const convData = conversations.get(callSid);
    if (convData) {
      convData.messages.push({
        role: 'lead',
        content: SpeechResult,
        timestamp: new Date()
      });

      // Extract information from conversation
      const userLower = SpeechResult.toLowerCase();
      
      // Check service area
      SERVICE_AREAS.forEach(area => {
        if (userLower.includes(area.toLowerCase())) {
          convData.leadInfo.location = area;
          convData.serviceableArea = true;
        }
      });

      // Check for negative service area indicators
      if (userLower.includes('westlands') || userLower.includes('kilimani') || 
          userLower.includes('karen') || userLower.includes('not in')) {
        convData.serviceableArea = false;
      }

      // Extract package interest
      if (userLower.includes('mobile') || userLower.includes('basic')) {
        convData.leadInfo.interestedPackage = 'Mobile';
      } else if (userLower.includes('entertainment') || userLower.includes('streaming')) {
        convData.leadInfo.interestedPackage = 'Entertainment';
      } else if (userLower.includes('business') || userLower.includes('office')) {
        convData.leadInfo.interestedPackage = 'Business';
      }

      broadcastConversation(callSid, convData);
    }

    // Get AI response
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are Sarah, a friendly sales agent for Uncapped Network, a fiber internet provider in Nairobi, Kenya.

COMPANY DETAILS:
- Company: Uncapped Network
- Service Areas: Utawala, Umoja, Mlolongo, and Katani ONLY
- Office: Utawala, Kokoto Crescent Road
- Contact: +254114561401

PACKAGES:
1. Mobile Package - Ksh 1,499/month
   - 6Mbps average speed
   - Line rental included
   - No activation charges

2. Entertainment Package - Ksh 1,999/month  
   - 12Mbps average speed
   - Perfect for streaming and family use on weekends
   - Line rental included
   - No activation charges

3. Business Package - Ksh 2,499/month
   - 20Mbps average speed
   - Ideal for offices and businesses
   - Line rental included
   - No activation charges

YOUR GOAL:
1. Confirm they are in a serviceable area (Utawala, Umoja, Mlolongo, or Katani)
2. Understand their current internet situation and pain points
3. Identify their usage needs (basic browsing, streaming, business, etc.)
4. Recommend the best package for their needs
5. If interested and in service area, offer to schedule installation or transfer to technical team

IMPORTANT:
- If they are NOT in Utawala, Umoja, Mlolongo, or Katani, politely inform them we don't service their area yet but can take their details for future expansion
- Keep responses conversational and under 50 words
- Ask one question at a time
- Use Kenyan context (mention Safaricom, local streaming habits, etc.)
- Emphasize "no activation charges" and "line rental included"
- Be empathetic about common internet issues in Kenya (slow speeds, high costs, unreliable connections)

Lead Info: ${JSON.stringify(callData?.leadInfo || {})}`
        },
        ...conversation
      ],
      max_tokens: 150,
      temperature: 0.7
    });

    const aiResponse = completion.choices[0].message.content;
    conversation.push({
      role: 'assistant',
      content: aiResponse
    });

    // Update conversation storage
    if (convData) {
      convData.messages.push({
        role: 'agent',
        content: aiResponse,
        timestamp: new Date()
      });
      
      // Qualification logic
      const userLower = SpeechResult.toLowerCase();
      const responseLower = aiResponse.toLowerCase();
      
      if ((userLower.includes('interested') || userLower.includes('yes') || userLower.includes('sure')) && 
          convData.serviceableArea === true) {
        convData.qualified = true;
      } else if (convData.serviceableArea === false) {
        convData.qualified = false;
        convData.notes.push({
          content: 'Outside service area',
          timestamp: new Date()
        });
      }
      
      broadcastConversation(callSid, convData);
    }

    // Update active call
    activeCalls.set(callSid, {
      ...callData,
      conversation
    });

    // Respond with AI message
    twiml.say({ 
      voice: 'Polly.Joanna',
      language: 'en-US'
    }, aiResponse);

    // Check if conversation should end
    if (aiResponse.toLowerCase().includes('goodbye') || 
        aiResponse.toLowerCase().includes('talk soon') ||
        aiResponse.toLowerCase().includes('thank you for your time')) {
      twiml.hangup();
    } else {
      twiml.gather({
        input: 'speech',
        action: `/api/voice/process-speech?callSid=${callSid}`,
        speechTimeout: 'auto',
        speechModel: 'phone_call',
        language: 'en-US'
      });
    }

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    console.error('Error processing speech:', error);
    twiml.say('I apologize, I\'m having technical difficulties. Please call us directly at 0114561401 or visit our office in Utawala.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Call status callback
app.post('/api/calls/status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  
  const convData = conversations.get(CallSid);
  if (convData) {
    convData.status = CallStatus;
    if (CallStatus === 'completed') {
      convData.endTime = new Date();
      convData.duration = Math.floor((convData.endTime - convData.startTime) / 1000);
    }
    broadcastConversation(CallSid, convData);
  }

  res.sendStatus(200);
});

// Get all conversations
app.get('/api/conversations', (req, res) => {
  const convArray = Array.from(conversations.values());
  res.json(convArray);
});

// Get specific conversation
app.get('/api/conversations/:callSid', (req, res) => {
  const conv = conversations.get(req.params.callSid);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  res.json(conv);
});

// Update lead qualification status
app.post('/api/conversations/:callSid/qualify', (req, res) => {
  const { qualified, notes } = req.body;
  const conv = conversations.get(req.params.callSid);
  
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  conv.qualified = qualified;
  if (notes) {
    conv.notes.push({
      content: notes,
      timestamp: new Date()
    });
  }

  broadcastConversation(req.params.callSid, conv);
  res.json(conv);
});

// Get statistics
app.get('/api/stats', (req, res) => {
  const convArray = Array.from(conversations.values());
  const stats = {
    totalCalls: convArray.length,
    qualifiedLeads: convArray.filter(c => c.qualified === true).length,
    unqualifiedLeads: convArray.filter(c => c.qualified === false).length,
    pendingReview: convArray.filter(c => c.qualified === null && c.status === 'completed').length,
    activeCalls: convArray.filter(c => c.status === 'in-progress').length,
    byArea: {},
    byPackage: {}
  };

  // Count by area
  SERVICE_AREAS.forEach(area => {
    stats.byArea[area] = convArray.filter(c => c.leadInfo?.location === area).length;
  });

  // Count by interested package
  Object.keys(PACKAGES).forEach(pkg => {
    stats.byPackage[PACKAGES[pkg].name] = convArray.filter(
      c => c.leadInfo?.interestedPackage === PACKAGES[pkg].name
    ).length;
  });

  res.json(stats);
});

const server = app.listen(PORT, () => {
  console.log(`Uncapped Network Voice Agent Server running on port ${PORT}`);
});

// Upgrade HTTP server to handle WebSocket
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});