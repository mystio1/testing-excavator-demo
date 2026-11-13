import type { Localized } from "./i18n";

/**
 * The tappable shortcuts, as an owner reads them.
 *
 * Separate from the registry's `summary` on purpose. Those summaries are
 * written for the model — "List the machines and their current status (working,
 * idle, in service)" — and they are in English. These are what somebody who
 * may not read well sees on a button in their own language: short, concrete,
 * and phrased as the thing they want, not as the capability that does it.
 *
 * Every id here must be one the registry allows a tap to run (a read with no
 * fields), and every one it allows must appear here — otherwise a capability
 * is either unreachable by tap or offered and then refused.
 * `tests/agent/manifest.test.ts` holds both halves of that to account.
 */
export const SHORTCUTS: { id: string; label: Localized }[] = [
  {
    id: "business.dashboard.view",
    label: { en: "How is business this month?", hi: "इस महीने कारोबार कैसा है?", mr: "या महिन्यात व्यवसाय कसा आहे?", gu: "આ મહિને ધંધો કેવો છે?", ta: "இந்த மாதம் வியாபாரம் எப்படி?", te: "ఈ నెల వ్యాపారం ఎలా ఉంది?", kn: "ಈ ತಿಂಗಳು ವ್ಯಾಪಾರ ಹೇಗಿದೆ?", bn: "এই মাসে ব্যবসা কেমন?", pa: "ਇਸ ਮਹੀਨੇ ਕਾਰੋਬਾਰ ਕਿਵੇਂ ਹੈ?" },
  },
  {
    id: "machine.list",
    label: { en: "My machines", hi: "मेरी मशीनें", mr: "माझी मशीन", gu: "મારા મશીન", ta: "என் இயந்திரங்கள்", te: "నా యంత్రాలు", kn: "ನನ್ನ ಯಂತ್ರಗಳು", bn: "আমার মেশিন", pa: "ਮੇਰੀਆਂ ਮਸ਼ੀਨਾਂ" },
  },
  {
    id: "approvals.view",
    label: { en: "What needs my approval?", hi: "मुझे क्या मंज़ूर करना है?", mr: "मला काय मंजूर करायचे आहे?", gu: "મારી મંજૂરી શેની બાકી છે?", ta: "என் ஒப்புதல் எதற்கு வேண்டும்?", te: "నా ఆమోదం ఏమిటికి కావాలి?", kn: "ನನ್ನ ಅನುಮೋದನೆ ಯಾವುದಕ್ಕೆ ಬೇಕು?", bn: "আমার অনুমোদন কী কী বাকি?", pa: "ਮੇਰੀ ਮਨਜ਼ੂਰੀ ਕਿਸ ਲਈ ਚਾਹੀਦੀ ਹੈ?" },
  },
  {
    id: "bill.list",
    label: { en: "Money still to come in", hi: "कितना पैसा आना बाकी है", mr: "किती पैसे येणे बाकी आहेत", gu: "કેટલા પૈસા આવવાના બાકી છે", ta: "வர வேண்டிய பணம் எவ்வளவு", te: "రావాల్సిన డబ్బు ఎంత", kn: "ಬರಬೇಕಾದ ಹಣ ಎಷ್ಟು", bn: "কত টাকা পাওনা আছে", pa: "ਕਿੰਨੇ ਪੈਸੇ ਆਉਣੇ ਬਾਕੀ ਹਨ" },
  },
  {
    id: "operator.list",
    label: { en: "My operators", hi: "मेरे ऑपरेटर", mr: "माझे ऑपरेटर", gu: "મારા ઓપરેટર", ta: "என் ஓட்டுநர்கள்", te: "నా ఆపరేటర్లు", kn: "ನನ್ನ ಚಾಲಕರು", bn: "আমার অপারেটর", pa: "ਮੇਰੇ ਆਪਰੇਟਰ" },
  },
  {
    id: "customer.list",
    label: { en: "My customers", hi: "मेरे ग्राहक", mr: "माझे ग्राहक", gu: "મારા ગ્રાહકો", ta: "என் வாடிக்கையாளர்கள்", te: "నా కస్టమర్లు", kn: "ನನ್ನ ಗ್ರಾಹಕರು", bn: "আমার খদ্দের", pa: "ਮੇਰੇ ਗਾਹਕ" },
  },
  {
    id: "assistant.history.view",
    label: {
      en: "What did you do for me?",
      hi: "तुमने मेरे लिये क्या किया?",
      mr: "तुम्ही माझ्यासाठी काय केले?", gu: "તમે મારા માટે શું કર્યું?", ta: "நீங்கள் எனக்கு என்ன செய்தீர்கள்?", te: "మీరు నా కోసం ఏమి చేశారు?", kn: "ನೀವು ನನಗಾಗಿ ಏನು ಮಾಡಿದಿರಿ?", bn: "আপনি আমার জন্য কী করেছেন?", pa: "ਤੁਸੀਂ ਮੇਰੇ ਲਈ ਕੀ ਕੀਤਾ?" },
  },
  {
    id: "site.list",
    label: { en: "My sites", hi: "मेरी साइटें", mr: "माझ्या साईट्स", gu: "મારી સાઇટો", ta: "என் தளங்கள்", te: "నా సైట్లు", kn: "ನನ್ನ ಸೈಟ್‌ಗಳು", bn: "আমার সাইট", pa: "ਮੇਰੀਆਂ ਸਾਈਟਾਂ" },
  },
];
