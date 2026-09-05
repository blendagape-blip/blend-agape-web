const { google } = require("googleapis");

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/calendar",
  ]);
}

const MIN_LEAD_DAYS = 3;

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método no permitido." }) };
  }

  try {
    const data = JSON.parse(event.body || "{}");
    const { date, startTime, endTime, name, phone, people, occasion } = data;

    if (!date || !startTime || !endTime || !name || !phone) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Faltan datos obligatorios." }),
      };
    }

    // anticipación mínima
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() + MIN_LEAD_DAYS);
    const chosenDate = new Date(`${date}T00:00:00-03:00`);
    if (chosenDate < minDate) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: `Las reservas necesitan al menos ${MIN_LEAD_DAYS} días de anticipación.`,
        }),
      };
    }

    if (startTime >= endTime) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "El horario de fin debe ser posterior al de inicio." }),
      };
    }

    const auth = getAuth();
    const calendar = google.calendar({ version: "v3", auth });
    const calendarId = process.env.CALENDAR_ID;

    const startISO = `${date}T${startTime}:00-03:00`;
    const endISO = `${date}T${endTime}:00-03:00`;

    // re-chequeo de superposición del lado del servidor (por si dos personas reservan a la vez)
    const existing = await calendar.events.list({
      calendarId,
      timeMin: new Date(`${date}T00:00:00-03:00`).toISOString(),
      timeMax: new Date(`${date}T23:59:59-03:00`).toISOString(),
      singleEvents: true,
    });

    const newStart = new Date(startISO).getTime();
    const newEnd = new Date(endISO).getTime();

    const overlaps = (existing.data.items || [])
      .filter((ev) => ev.status !== "cancelled")
      .some((ev) => {
        const s = new Date(ev.start.dateTime || ev.start.date).getTime();
        const e = new Date(ev.end.dateTime || ev.end.date).getTime();
        return newStart < e && newEnd > s;
      });

    if (overlaps) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: "Ese horario ya quedó reservado. Elegí otro, por favor." }),
      };
    }

    const eventRes = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `Pendiente de confirmar — ${name}`,
        description: [
          `Teléfono: ${phone}`,
          people ? `Personas: ${people}` : null,
          occasion ? `Motivo: ${occasion}` : null,
          "Reservado desde la web — a confirmar por WhatsApp.",
        ]
          .filter(Boolean)
          .join("\n"),
        start: { dateTime: startISO, timeZone: "America/Argentina/Mendoza" },
        end: { dateTime: endISO, timeZone: "America/Argentina/Mendoza" },
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, eventId: eventRes.data.id }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "No se pudo crear la reserva.", detail: err.message }),
    };
  }
};
