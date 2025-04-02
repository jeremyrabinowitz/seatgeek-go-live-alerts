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

async function fetchRSSFeedsFromAirtableView() {
  const response = await axios.get(AIRTABLE_URL, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
    },
    params: {
      maxRecords: 50,
      view: AIRTABLE_VIEW,
    },
  });
  return response.data.records;
}

async function fetchRSSFeed(rssUrl) {
  const response = await axios.get(rssUrl);
  return response.data;
}

function checkForSeatGeekMention(xml) {
  const match = xml.match(/<entry>(.*?)<\/entry>/s);
  if (!match) return { found: false };

  const entry = match[1];
  const descMatch =
    entry.match(/<media:description.*?>(.*?)<\/media:description>/s) ||
    entry.match(/<content.*?>(.*?)<\/content>/s);

  const description = descMatch ? descMatch[1] : "";
  const linkMatch = entry.match(/<link.*?href=\"(.*?)\"/);
  const link = linkMatch ? linkMatch[1] : "";

  const isMatch = description.toLowerCase().includes("seatgeek");

  return {
    found: isMatch,
    link,
    description,
  };
}

async function sendSlackAlert(link) {
  await axios.post(SLACK_WEBHOOK_URL, {
    username: "Jade.ai",
    channel: "#seatgeek-go-live-alerts",
    text: `🚨🎟️ A SeatGeek spot went live!\n${link}`,
  });
}

async function markAlertSent(recordId) {
  await axios.patch(
    `${AIRTABLE_URL}/${recordId}`,
    {
      fields: {
        "Go-Live Alert Sent": true,
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

(async () => {
  try {
    const records = await fetchRSSFeedsFromAirtableView();
    for (const record of records) {
      const rss = record.fields["RSS Feed (Influencers)"];
      const brand = record.fields["Brand"];
      if (!rss || brand !== "SeatGeek") continue;

      const xml = await fetchRSSFeed(rss);
      const check = checkForSeatGeekMention(xml);

      if (check.found) {
        await sendSlackAlert(check.link);
        await markAlertSent(record.id);
      }
    }
  } catch (err) {
    console.error("Error running SeatGeek monitor:", err);
  }
})();
