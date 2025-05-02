// seatgeek-go-live-alerts.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE;
const AIRTABLE_VIEW = process.env.AIRTABLE_VIEW;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL_SEATGEEK;

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;

// Fetch records from the specified Airtable view
async function fetchRSSFeedsFromAirtableView() {
  const response = await axios.get(AIRTABLE_URL, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    },
    params: {
      maxRecords: 100,
      view: AIRTABLE_VIEW,
    },
  });
  return response.data.records;
}

// Retrieve XML data from a YouTube RSS feed
async function fetchRSSFeed(rssUrl) {
  const response = await axios.get(rssUrl);
  return response.data;
}

// Check if the latest video mentions SeatGeek and was posted today
function checkForSeatGeekMention(xml) {
  const match = xml.match(/<entry>(.*?)<\/entry>/s);
  if (!match) return { found: false };

  const entry = match[1];
  const descMatch =
    entry.match(/<media:description.*?>(.*?)<\/media:description>/s) ||
    entry.match(/<content.*?>(.*?)<\/content>/s);

  const pubDateMatch = entry.match(/<published>(.*?)<\/published>/);
  const publishedDate = pubDateMatch ? new Date(pubDateMatch[1]) : null;

  const today = new Date();
  const isToday = publishedDate &&
    publishedDate.getDate() === today.getDate() &&
    publishedDate.getMonth() === today.getMonth() &&
    publishedDate.getFullYear() === today.getFullYear();

  const description = descMatch ? descMatch[1] : "";
  const linkMatch = entry.match(/<link.*?href=\"(.*?)\"/);
  const link = linkMatch ? linkMatch[1] : "";

  const isMatch = description.toLowerCase().includes("seatgeek");

  return {
    found: isMatch && isToday,
    link,
    description,
  };
}

// Send a Slack alert message
async function sendSlackAlert(link) {
  await axios.post(SLACK_WEBHOOK_URL, {
    username: "Jade.ai",
    channel: "#seatgeek-go-live-alerts",
    text: `🚨🎟️ A SeatGeek spot went live!\n${link}`,
  });
}

// Update the Go-Live Alert Sent and Last Video Link Alerted fields for a specific record
async function updateAlertStatus(recordId, videoLink) {
  await axios.patch(
    `${AIRTABLE_URL}/${recordId}`,
    {
      fields: {
        "Go-Live Alert Sent": true,
        "Last Video Link Alerted": videoLink,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// Update only the Last Video Link Alerted field for duplicate RSS records
async function updateLastAlertedLinks(records, videoLink) {
  const updates = records.map(record => ({
    id: record.id,
    fields: {
      "Last Video Link Alerted": videoLink,
    },
  }));

  while (updates.length) {
    const batch = updates.splice(0, 10);
    await axios.patch(
      AIRTABLE_URL,
      { records: batch },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
  }
}

(async () => {
  try {
    const records = await fetchRSSFeedsFromAirtableView();

    // Group records by RSS Feed
    const grouped = {};
    for (const record of records) {
      const rss = record.fields["RSS Feed (Influencers)"];
      const brand = record.fields["Brand"];
      if (!rss || brand !== "SeatGeek") continue;

      if (!grouped[rss]) grouped[rss] = [];
      grouped[rss].push(record);
    }

    // Process each RSS feed only once
    for (const rss in grouped) {
      const group = grouped[rss];
      const xml = await fetchRSSFeed(rss);
      const check = checkForSeatGeekMention(xml);

      if (!check.found) continue;

      // Only alert if this video hasn't already been alerted for this feed
      const alreadyAlerted = group.some(
        rec => rec.fields["Last Video Link Alerted"] === check.link
      );
      if (alreadyAlerted) continue;

      // Send the alert
      await sendSlackAlert(check.link);

      // Mark the first eligible row as alerted
      const firstUnsent = group.find(
        rec => !rec.fields["Go-Live Alert Sent"]
      );
      if (firstUnsent) {
        await updateAlertStatus(firstUnsent.id, check.link);
      }

      // Mark all records for this feed with the video link to prevent repeat alerts
      await updateLastAlertedLinks(group, check.link);
    }
  } catch (err) {
    console.error("Error running SeatGeek monitor:", err);
  }
})();
