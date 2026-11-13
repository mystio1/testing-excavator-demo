import { LANG_NAME as _LANG_NAME, type AgentLang, type Localized } from "./i18n";
void _LANG_NAME;

/**
 * What the owner is told before the microphone is ever used.
 *
 * Speaking to the assistant sends a few seconds of audio to a speech service
 * outside India. That audio carries customer names, site names and phone
 * numbers — other people's personal data, not just the owner's — so this is a
 * disclosure that has to be made, not a dialog to get past.
 *
 * Written for someone who may not read well, which also happens to be what the
 * law wants: specific, plain, and about one thing. No "by continuing you agree
 * to our terms". It says where the sound goes, what is kept, and that typing
 * works instead — and declining has to be as easy as accepting, which is why
 * the panel's other button is not a close icon but "I'll type instead".
 *
 * NOT legal advice. The mechanism is here — the notice, the record of which
 * wording was agreed to, and the refusal path. The text should be reviewed by
 * someone qualified before launch, and the processor agreement with the speech
 * provider is a separate piece of paperwork that no code can stand in for.
 */

/** Bumped when the wording changes materially, so an older consent is not
 * silently inherited by a new notice. Stored alongside the timestamp. */
export const VOICE_CONSENT_VERSION = "voice-1";

export const VOICE_NOTICE: Localized<{ title: string; body: string; accept: string; decline: string }> = {
  en: {
    title: "Before you speak to me",
    body:
      "When you talk to me, a few seconds of sound is sent to a speech service outside India to turn it into words. That sound can include your customers' names and phone numbers. It is not saved anywhere — not by me and not on your phone — and it is deleted as soon as the words come back. You can always type instead.",
    accept: "I understand, use the microphone",
    decline: "No, I'll type instead",
  },
  hi: {
    title: "बोलने से पहले एक बात",
    body:
      "जब आप मुझसे बोलते हैं, तो कुछ सेकंड की आवाज़ शब्दों में बदलने के लिए भारत से बाहर की एक सेवा को भेजी जाती है. उस आवाज़ में आपके ग्राहकों के नाम और नंबर भी हो सकते हैं. वह आवाज़ कहीं सेव नहीं होती — न मेरे पास, न आपके फ़ोन में — और शब्द मिलते ही मिटा दी जाती है. आप चाहें तो लिखकर भी बता सकते हैं.",
    accept: "समझ गया, माइक चालू करें",
    decline: "नहीं, मैं लिखकर बताऊँगा",
  },
  mr: {
    title: "बोलण्यापूर्वी एक गोष्ट",
    body:
      "तुम्ही माझ्याशी बोलता तेव्हा काही सेकंदांचा आवाज शब्दांत बदलण्यासाठी भारताबाहेरच्या एका सेवेकडे पाठवला जातो. त्या आवाजात तुमच्या ग्राहकांची नावे आणि नंबरही असू शकतात. तो आवाज कुठेही साठवला जात नाही — माझ्याकडेही नाही आणि तुमच्या फोनमध्येही नाही — आणि शब्द मिळाल्यावर लगेच पुसला जातो. तुम्हाला हवे असल्यास टाइप करूनही सांगू शकता.",
    accept: "समजले, माइक सुरू करा",
    decline: "नको, मी टाइप करतो",
  },
  gu: {
      "title": "બોલતા પહેલાં એક વાત",
      "body": "તમે મારી સાથે બોલો ત્યારે થોડી સેકન્ડનો આવાજ શબ્દોમાં બદલવા ભારત બહારની એક સેવાને મોકલાય છે. તે આવાજમાં તમારા ગ્રાહકોનાં નામ અને નંબર પણ હોઈ શકે. તે આવાજ ક્યાંય સેવ થતો નથી — મારી પાસે પણ નહીં, તમારા ફોનમાં પણ નહીં — અને શબ્દો મળતાંની સાથે મિટાવી દેવાય છે. તમે ઇચ્છો તો લખીને પણ કહી શકો છો.",
      "accept": "સમજી ગયો, માઇક ચાલુ કરો",
      "decline": "ના, હું લખીને કહીશ"
  },
  ta: {
      "title": "பேசுவதற்கு முன் ஒரு விஷயம்",
      "body": "நீங்கள் என்னுடன் பேசும்போது சில வினாடி ஒலி வார்த்தைகளாக மாற்ற இந்தியாவுக்கு வெளியே உள்ள ஒரு சேவைக்கு அனுப்பப்படுகிறது. அந்த ஒலியில் உங்கள் வாடிக்கையாளர்களின் பெயர்களும் எண்களும் இருக்கலாம். அந்த ஒலி எங்கும் சேமிக்கப்படுவதில்லை — என்னிடமும் இல்லை, உங்கள் ஃபோனிலும் இல்லை — வார்த்தைகள் கிடைத்த உடனே அழிக்கப்படுகிறது. விரும்பினால் தட்டச்சு செய்தும் சொல்லலாம்.",
      "accept": "புரிந்தது, மைக்கை இயக்குங்கள்",
      "decline": "இல்லை, நான் தட்டச்சு செய்கிறேன்"
  },
  te: {
      "title": "మాట్లాడే ముందు ఒక మాట",
      "body": "మీరు నాతో మాట్లాడినప్పుడు కొన్ని సెకన్ల శబ్దం పదాలుగా మార్చడానికి భారతదేశం వెలుపలి ఒక సేవకు పంపబడుతుంది. ఆ శబ్దంలో మీ కస్టమర్ల పేర్లు మరియు నంబర్లు కూడా ఉండవచ్చు. ఆ శబ్దం ఎక్కడా సేవ్ కాదు — నా వద్ద కూడా కాదు, మీ ఫోన్లో కూడా కాదు — పదాలు వచ్చిన వెంటనే తొలగించబడుతుంది. మీకు కావాలంటే టైప్ చేసి కూడా చెప్పవచ్చు.",
      "accept": "అర్థమైంది, మైక్ ఆన్ చేయండి",
      "decline": "వద్దు, నేను టైప్ చేస్తాను"
  },
  kn: {
      "title": "ಮಾತನಾಡುವ ಮೊದಲು ಒಂದು ಮಾತು",
      "body": "ನೀವು ನನ್ನೊಂದಿಗೆ ಮಾತನಾಡಿದಾಗ ಕೆಲವು ಸೆಕೆಂಡುಗಳ ಧ್ವನಿ ಪದಗಳಾಗಿ ಬದಲಾಯಿಸಲು ಭಾರತದ ಹೊರಗಿನ ಒಂದು ಸೇವೆಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ. ಆ ಧ್ವನಿಯಲ್ಲಿ ನಿಮ್ಮ ಗ್ರಾಹಕರ ಹೆಸರು ಮತ್ತು ನಂಬರ್‌ಗಳೂ ಇರಬಹುದು. ಆ ಧ್ವನಿ ಎಲ್ಲಿಯೂ ಉಳಿಯುವುದಿಲ್ಲ — ನನ್ನ ಬಳಿಯೂ ಇಲ್ಲ, ನಿಮ್ಮ ಫೋನಿನಲ್ಲಿಯೂ ಇಲ್ಲ — ಪದಗಳು ಬಂದ ತಕ್ಷಣ ಅಳಿಸಲಾಗುತ್ತದೆ. ನೀವು ಬಯಸಿದರೆ ಟೈಪ್ ಮಾಡಿಯೂ ಹೇಳಬಹುದು.",
      "accept": "ಅರ್ಥವಾಯಿತು, ಮೈಕ್ ಆನ್ ಮಾಡಿ",
      "decline": "ಬೇಡ, ನಾನು ಟೈಪ್ ಮಾಡುತ್ತೇನೆ"
  },
  bn: {
      "title": "বলার আগে একটা কথা",
      "body": "আপনি আমার সঙ্গে কথা বললে কয়েক সেকেন্ডের আওয়াজ শব্দে বদলানোর জন্য ভারতের বাইরের একটি পরিষেবায় পাঠানো হয়। সেই আওয়াজে আপনার খদ্দেরদের নাম ও নম্বরও থাকতে পারে। সেই আওয়াজ কোথাও সেভ হয় না — আমার কাছেও নয়, আপনার ফোনেও নয় — এবং শব্দ পাওয়ার সঙ্গে সঙ্গে মুছে ফেলা হয়। আপনি চাইলে লিখেও বলতে পারেন।",
      "accept": "বুঝেছি, মাইক চালু করুন",
      "decline": "না, আমি লিখে বলব"
  },
  pa: {
      "title": "ਬੋਲਣ ਤੋਂ ਪਹਿਲਾਂ ਇੱਕ ਗੱਲ",
      "body": "ਜਦੋਂ ਤੁਸੀਂ ਮੇਰੇ ਨਾਲ ਬੋਲਦੇ ਹੋ, ਤਾਂ ਕੁਝ ਸਕਿੰਟਾਂ ਦੀ ਆਵਾਜ਼ ਸ਼ਬਦਾਂ ਵਿੱਚ ਬਦਲਣ ਲਈ ਭਾਰਤ ਤੋਂ ਬਾਹਰ ਦੀ ਇੱਕ ਸੇਵਾ ਨੂੰ ਭੇਜੀ ਜਾਂਦੀ ਹੈ। ਉਸ ਆਵਾਜ਼ ਵਿੱਚ ਤੁਹਾਡੇ ਗਾਹਕਾਂ ਦੇ ਨਾਮ ਅਤੇ ਨੰਬਰ ਵੀ ਹੋ ਸਕਦੇ ਹਨ। ਉਹ ਆਵਾਜ਼ ਕਿਤੇ ਸੇਵ ਨਹੀਂ ਹੁੰਦੀ — ਨਾ ਮੇਰੇ ਕੋਲ, ਨਾ ਤੁਹਾਡੇ ਫ਼ੋਨ ਵਿੱਚ — ਅਤੇ ਸ਼ਬਦ ਮਿਲਦੇ ਸਾਰ ਮਿਟਾ ਦਿੱਤੀ ਜਾਂਦੀ ਹੈ। ਤੁਸੀਂ ਚਾਹੋ ਤਾਂ ਲਿਖ ਕੇ ਵੀ ਦੱਸ ਸਕਦੇ ਹੋ।",
      "accept": "ਸਮਝ ਗਿਆ, ਮਾਈਕ ਚਾਲੂ ਕਰੋ",
      "decline": "ਨਹੀਂ, ਮੈਂ ਲਿਖ ਕੇ ਦੱਸਾਂਗਾ"
  },
};

/** The exact wording agreed to, recorded with the consent so a later change to
 * the notice cannot inherit it. */
export function noticeFingerprint(lang: AgentLang): string {
  return `${VOICE_CONSENT_VERSION}:${lang}`;
}
