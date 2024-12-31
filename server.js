require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { createEvents } = require("ics");
const { DateTime } = require("luxon"); // For time handling

const app = express();
const PORT = 3000;

// Replace with your Gemini API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Middleware
app.use(bodyParser.json());
app.use(express.static("public")); // Serve the frontend files from the "public" folder

// Route to process user input and return .ics content
app.post("/generate", async (req, res) => {
  const userInput = req.body.text;
  const userTimeZone = req.body.timeZone; // Get the user's time zone from the request

  if (!userInput || !userTimeZone) {
    console.error("Error: Missing input text or time zone.");
    return res.status(400).json({ error: "Text input and time zone are required" });
  }

  try {
    console.log("Received input:", userInput);
    console.log("Detected time zone:", userTimeZone);

    // Step 1: Call Gemini API to extract event details
    const geminiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: `Extract calendar events from the following text:\n"${userInput}"\n, and return the details in this exact JSON format:\n[{"title": "Event Title", "start": "YYYY-MM-DD HH:mm", "end": "YYYY-MM-DD HH:mm (if provided)", "location": "Optional"}]\nMake sure to use 24-hour time format. NOTE IF THERE IS NO END TIME SET IT AN HOUR LATER FROM THE START TIME`,
              },
            ],
          },
        ],
      },
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("Gemini API response:", JSON.stringify(geminiResponse.data, null, 2));

    // Extract the response text from Gemini
    const candidates = geminiResponse.data?.candidates;
    if (!candidates || candidates.length === 0) {
      console.error("Error: No candidates returned from Gemini API.");
      return res.status(500).json({ error: "No candidates returned from Gemini API." });
    }

    // Extract the content field from the first candidate
    const geminiOutput = candidates[0]?.content;

    // Check if content is an object and extract the text field
    let rawText;
    if (typeof geminiOutput === "object" && geminiOutput.parts && geminiOutput.parts.length > 0) {
      rawText = geminiOutput.parts[0].text; // Extract the text from the parts array
    } else if (typeof geminiOutput === "string") {
      rawText = geminiOutput; // If it's already a string, use it directly
    } else {
      console.error("Error: Unexpected Gemini API response format.");
      return res.status(500).json({ error: "Unexpected Gemini API response format." });
    }

    console.log("Extracted raw text:", rawText);

    // Remove Markdown formatting (triple backticks and "json" label)
    rawText = rawText.replace(/```json\n/, "").replace(/```\n?$/, "");

    console.log("Cleaned JSON string:", rawText);

    // Parse the cleaned JSON string
    let events;
    try {
      events = JSON.parse(rawText);
    } catch (err) {
      console.error("Error parsing JSON from Gemini output:", err.message);
      console.error("Raw cleaned text:", rawText);
      return res.status(500).json({ error: "Failed to parse JSON from Gemini API response.", details: rawText });
    }

    if (!events || events.length === 0) {
      console.error("Error: No events extracted from Gemini API response.");
      return res.status(500).json({ error: "No events found in the input text." });
    }

    console.log("Extracted events:", events);

    // Step 2: Adjust times and generate .ics content
    const icsEvents = events.map((event) => {
      // Adjust start time by subtracting 3 hours
      const startDateTime = DateTime.fromFormat(event.start, "yyyy-MM-dd HH:mm", { zone: userTimeZone }).minus({ hours: 3 });
      // Adjust end time by subtracting 3 hours (if end time is provided)
      const endDateTime = event.end
        ? DateTime.fromFormat(event.end, "yyyy-MM-dd HH:mm", { zone: userTimeZone }).minus({ hours: 3 })
        : null;

      return {
        title: event.title,
        start: [
          startDateTime.year,
          startDateTime.month,
          startDateTime.day,
          startDateTime.hour,
          startDateTime.minute,
        ],
        end: endDateTime
          ? [
              endDateTime.year,
              endDateTime.month,
              endDateTime.day,
              endDateTime.hour,
              endDateTime.minute,
            ]
          : null,
        location: event.location || "",
      };
    });

    const { error, value } = createEvents(icsEvents);

    if (error) {
      console.error("Error creating .ics content:", error);
      return res.status(500).json({ error: "Failed to generate .ics content" });
    }

    console.log("Generated .ics content:", value);

    // Send the .ics content back to the frontend
    res.json({ icsContent: value });
  } catch (error) {
    console.error("Error processing request:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to process request", details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
