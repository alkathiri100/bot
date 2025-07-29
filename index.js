const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const creds = JSON.parse(process.env.GOOGLE_CREDS);

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "subesta2025";
const token = "EAAQNJ0oTVFABO6qOkSIZB5pNEyFJj533ZBZBM52R85QsEJWOYZAZC1GkG76SfBPly2NFQH7dKfsMUiQ6u6ZCfgcYBMCuymoU8W0esDY3q3VMHy9EFo3yThb9RrfKAZBEpnMK4omKI30GZCeZA30ZAjCL5BV3Rk1OCoojfkA6UsffYSshEKQ5izcZA8lhVSfj28S8H25jAZDZD"; // اختصرته هنا
const phone_number_id = "700625943131354";
const sheetId = "1HMS3lcMRs6h_Xhr4Z73fQFbBiyzcZfIK06FIkK1cW0E";

const userStates = {};

const districts = [
  "الأجاويد 1", "الأجاويد 2", "الأجاويد 3 (الألفيه)", "السنابل",
  "الهدى", "الفيصل", "الإسكان", "الخمره"
];

const services = [
  "تبريد", "سباكة", "كهرباء", "قرطاسية ودروس",
  "عقار", "جوالات", "عطارة", "أخرى"
];

const subservices = {
  "تبريد": ["صيانة (مكيفات-ثلاجات-غسالات)", "شراء جهاز جديد"],
  "قرطاسية ودروس": ["قرطاسية", "دروس"]
};

app.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && verifyToken === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.send("🚀 Bot is running");
});

app.post("/", async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);

  const from = message.from;
  const input = message?.text?.body?.trim() ||
    message?.interactive?.button_reply?.title?.trim() ||
    message?.interactive?.list_reply?.title?.trim();

  if (["تاني", "ابدأ", "start"].includes(input.toLowerCase())) {
    userStates[from] = { step: "choose_mode" };
    await sendButtonsMessage(
      from,
      "مرحبا بك في واتس الأجاويد",
      "اختر نوع المستخدم:",
      ["1 - طلب خدمة", "2 - مقدم خدمة"]
    );
    return res.sendStatus(200);
  }

  if (!userStates[from]) {
    userStates[from] = { step: "choose_mode" };
    await sendButtonsMessage(
      from,
      "مرحباً بك في واتس الأجاويد",
      "اختر نوع المستخدم:\n\n📝 ملاحظة: يمكنك في أي وقت كتابة 'تاني' أو 'start' للعودة إلى القائمة الرئيسية.",
      ["1 - طلب خدمة", "2 - مقدم خدمة"]
    );
    return res.sendStatus(200);
  }

  const state = userStates[from];

  if (state.step === "choose_mode") {
    if (input.startsWith("1")) {
      state.mode = "customer";
      state.step = "collect_district";
      await sendListMessage(from, "📍 اختيار الحي", "اختر الحي:", "الأحياء", districts);
    } else if (input.startsWith("2")) {
      state.mode = "technician";
      state.step = "collect_name";
      await sendTextMessage(from, "🙋‍♂️ أدخل اسمك الكامل:");
    } else {
      await sendButtonsMessage(from, "اختر نوع المستخدم:", "من فضلك اضغط على زر:", ["1 - طلب خدمة", "2 - مقدم خدمة"]);
    }
    return res.sendStatus(200);
  }

  if (state.mode === "technician") {
    switch (state.step) {
      case "collect_name":
        state.name = input;
        state.step = "collect_national_id";
        await sendTextMessage(from, "🪪 أدخل رقم الهوية الوطنية:");
        break;

      case "collect_national_id":
        state.id = input;
        state.step = "collect_district";
        await sendListMessage(from, "📍 اختيار الحي", "اختر الحي:", "الأحياء", districts);
        break;

      case "collect_district":
        state.district = input;
        state.step = "collect_service";
        await sendListMessage(from, "🛠 الخدمة", "اختر نوع الخدمة:", "الخدمات", services);
        break;

      case "collect_service":
        state.service = input;
        if (subservices[input]) {
          state.step = "collect_subservice";
          await sendListMessage(from, `🛠 ${input}`, "اختر نوع الفرع:", "أنواع الخدمة", subservices[input]);
        } else {
          state.subservice = "";
          state.step = "collect_certificate_url";
          await sendTextMessage(from, "📄 أرسل رابط الشهادة (Google Drive أو Dropbox):");
        }
        break;

      case "collect_subservice":
        state.subservice = input;
        state.step = "collect_certificate_url";
        await sendTextMessage(from, "📄 أرسل رابط الشهادة (Google Drive أو Dropbox):");
        break;

      case "collect_certificate_url":
        if (!input.startsWith("http")) {
          await sendTextMessage(from, "❌ الرابط غير صحيح. أرسل رابط يبدأ بـ http أو https.");
          return res.sendStatus(200);
        }
        state.certificate = input;
        state.phone = from;
        await saveTechnicianToSheet(state);
        await sendTextMessage(from, "✅ تم تسجيل بياناتك بنجاح. سيتم التواصل معك بعد المراجعة.");
        delete userStates[from];
        break;
    }
    return res.sendStatus(200);
  }

  if (state.mode === "customer") {
    switch (state.step) {
      case "collect_district":
        state.district = input;
        state.step = "collect_service";
        await sendListMessage(from, "🛠 الخدمة", "اختر نوع الخدمة:", "الخدمات", services);
        break;

      case "collect_service":
        state.service = input;
        if (subservices[input]) {
          state.step = "choose_subservice";
          await sendListMessage(from, `🛠 ${input}`, "اختر نوع الفرع:", "أنواع الخدمة", subservices[input]);
        } else {
          await handleCustomerService(from, state, "");
        }
        break;

      case "choose_subservice":
        state.subservice = input;
        await handleCustomerService(from, state, input);
        break;
    }
    return res.sendStatus(200);
  }

  userStates[from] = { step: "choose_mode" };
  await sendButtonsMessage(from, "مرحبا بك من جديد!", "اختر نوع المستخدم:", ["1 - طلب خدمة", "2 - مقدم خدمة"]);
  return res.sendStatus(200);
});

async function handleCustomerService(from, state, subservice) {
  const doc = new GoogleSpreadsheet(sheetId);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const reqSheet = doc.sheetsByTitle["Requests"];

  if (subservice === "دروس") {
    await sendTextMessage(from, "📚 رابط قناة الدروس:\nhttps://t.me/Englishstudy2030");
    await reqSheet.addRow({
      date: new Date().toLocaleString("ar-EG"),
      service: state.service,
      subservice,
      district: state.district,
      phone: from
    });
    delete userStates[from];
    return;
  }

  if (subservice === "قرطاسية") {
  const techSheet = doc.sheetsByTitle["Technicians"];
  const rows = await techSheet.getRows();

  const stationeryPerson = rows.find(r =>
    r.service?.toLowerCase().trim() === "قرطاسية ودروس".toLowerCase() &&
    r.subservice?.toLowerCase().trim() === "قرطاسية".toLowerCase() &&
    r.district?.trim() === state.district?.trim()
  );

  if (stationeryPerson?.phone) {
    await sendTextMessage(from, `📦 للتواصل مع المسؤول عن القرطاسية:\nhttps://wa.me/${stationeryPerson.phone}`);
  } else {
    await sendTextMessage(from, "❌ لا يوجد فني مسجل في هذا الحي لخدمة القرطاسية.");
    userStates[from] = { step: "choose_mode" };
    await sendButtonsMessage(from, "📋 هل تريد إعادة المحاولة؟", "اختر نوع المستخدم من جديد:", ["1 - طلب خدمة", "2 - مقدم خدمة"]);
    return;
  }

  await reqSheet.addRow({
    date: new Date().toLocaleString("ar-EG"),
    service: state.service,
    subservice,
    district: state.district,
    phone: from
  });

  delete userStates[from];
  return;
}

  const techSheet = doc.sheetsByTitle["Technicians"];
  const rows = await techSheet.getRows();
  const match = rows.find(r =>
    r.district?.trim() === state.district?.trim() &&
    r.service?.trim() === state.service?.trim() &&
    (r.subservice?.trim() || "") === (subservice?.trim() || "")
  );

  if (!match) {
    await sendTextMessage(from, "❌ لا يوجد فني مسجل في هذا الحي للخدمة المطلوبة حالياً.");
    userStates[from] = { step: "choose_mode" };
    await sendButtonsMessage(from, "📋 هل تريد إعادة المحاولة؟", "اختر نوع المستخدم من جديد:", ["1 - طلب خدمة", "2 - مقدم خدمة"]);
    return;
  }

  await sendTextMessage(from,
    `اضغط على رابط واتس المختص التالي وارسل له رقم 1 وسيتواصل معك:\n\nhttps://wa.me/${match.phone}\n\nالحي: ${state.district}\nالخدمة: ${state.service}${subservice ? " - " + subservice : ""}\n\nعلماً أن التنفيذ والاتفاق يكون بينكما وهذه المنصة وسيطة، دون أدنى مسؤولية.`);

  await reqSheet.addRow({
    date: new Date().toLocaleString("ar-EG"),
    service: state.service,
    subservice,
    district: state.district,
    phone: from
  });
  delete userStates[from];
}

async function sendTextMessage(to, text) {
  await axios.post(`https://graph.facebook.com/v19.0/${phone_number_id}/messages`, {
    messaging_product: "whatsapp",
    to,
    text: { body: text }
  }, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
}

async function sendButtonsMessage(to, header, body, buttons) {
  await axios.post(`https://graph.facebook.com/v19.0/${phone_number_id}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "text", text: header },
      body: { text: body },
      action: {
        buttons: buttons.map((label, i) => ({
          type: "reply",
          reply: { id: `btn_${i}`, title: label }
        }))
      }
    }
  }, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
}

async function sendListMessage(to, header, body, sectionTitle, options) {
  const safeOptions = options.slice(0, 10).map((title, i) => ({
    id: `opt_${i}`,
    title: title.slice(0, 24),
    description: ""
  }));
  await axios.post(`https://graph.facebook.com/v19.0/${phone_number_id}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: header.slice(0, 20) },
      body: { text: body.slice(0, 60) },
      action: {
        button: "عرض القائمة",
        sections: [{ title: sectionTitle.slice(0, 24), rows: safeOptions }]
      }
    }
  }, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
}

async function saveTechnicianToSheet(state) {
  const doc = new GoogleSpreadsheet(sheetId);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["JoinRequests"];
  await sheet.addRow({
    name: state.name,
    id: state.id,
    district: state.district,
    service: state.service,
    subservice: state.subservice || "",
    phone: state.phone,
    certificate: state.certificate,
    submitted_at: new Date().toLocaleString("ar-EG"),
    status: "pending"
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
