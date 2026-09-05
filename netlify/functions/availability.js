const { google } = require("googleapis");

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/calendar",
  ]);
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const date = event.queryStringParameters && event.queryStringParameters.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Falta una fecha válida (YYYY-MM-DD)." }),
      };
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });
    const calendarId = process.env.CALENDAR_ID;

    const timeMin = new Date(`${date}T00:00:00-03:00`).toISOString();
    const timeMax = new Date(`${date}T23:59:59-03:00`).toISOString();

    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const busy = (res.data.items || [])
      .filter((ev) => ev.status !== "cancelled")
      .map((ev) => ({
        start: ev.start.dateTime || ev.start.date,
        end: ev.end.dateTime || ev.end.date,
      }));

    return { statusCode: 200, headers, body: JSON.stringify({ busy }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "No se pudo consultar el calendario.", detail: err.message }),
    };
  }
};
