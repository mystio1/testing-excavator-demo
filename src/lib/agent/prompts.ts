import type { AgentLang } from "./i18n";

/**
 * The questions the assistant asks, in the languages beyond the first three.
 *
 * Keyed by the English text rather than by a made-up id, for one reason: the
 * workflow definitions already read as prose —
 * `ask("Which machine?", "कौन सी मशीन?", "कोणते मशीन?")` — and that is worth
 * keeping. Adding six languages by rewriting twenty call sites would bury the
 * field each prompt belongs to under a wall of script, and the definitions are
 * the clearest documentation the registry has.
 *
 * So `ask()` looks the English up here and merges whatever is found. One place
 * to review, no churn in workflows.ts, and a prompt with no entry simply falls
 * back to English (see i18n.ts for why that is the right default).
 *
 * NOT reviewed by a native speaker — see REVIEWED in i18n.ts. These are the
 * short questions an owner is asked when something is missing, which is where
 * a clumsy phrasing is most survivable: the answer is a name or a number, and
 * the app checks it against real records either way.
 */
export const MORE_PROMPT_LANGS: Record<string, Partial<Record<AgentLang, string>>> = {
  "Which machine?": {
    gu: "કયું મશીન?",
    ta: "எந்த இயந்திரம்?",
    te: "ఏ యంత్రం?",
    kn: "ಯಾವ ಯಂತ್ರ?",
    bn: "কোন মেশিন?",
    pa: "ਕਿਹੜੀ ਮਸ਼ੀਨ?",
  },
  "Which operator?": {
    gu: "કયો ઓપરેટર?",
    ta: "எந்த ஓட்டுநர்?",
    te: "ఏ ఆపరేటర్?",
    kn: "ಯಾವ ಚಾಲಕ?",
    bn: "কোন অপারেটর?",
    pa: "ਕਿਹੜਾ ਆਪਰੇਟਰ?",
  },
  "Which customer?": {
    gu: "કયો ગ્રાહક?",
    ta: "எந்த வாடிக்கையாளர்?",
    te: "ఏ కస్టమర్?",
    kn: "ಯಾವ ಗ್ರಾಹಕ?",
    bn: "কোন খদ্দের?",
    pa: "ਕਿਹੜਾ ਗਾਹਕ?",
  },
  "Which site?": {
    gu: "કયી સાઇટ?",
    ta: "எந்த தளம்?",
    te: "ఏ సైట్?",
    kn: "ಯಾವ ಸೈಟ್?",
    bn: "কোন সাইট?",
    pa: "ਕਿਹੜੀ ਸਾਈਟ?",
  },
  "Which day?": {
    gu: "કયા દિવસનું?",
    ta: "எந்த நாள்?",
    te: "ఏ రోజు?",
    kn: "ಯಾವ ದಿನದ?",
    bn: "কোন দিনের?",
    pa: "ਕਿਹੜੇ ਦਿਨ ਦਾ?",
  },
  "From which day?": {
    gu: "કયા દિવસથી?",
    ta: "எந்த நாளிலிருந்து?",
    te: "ఏ రోజు నుంచి?",
    kn: "ಯಾವ ದಿನದಿಂದ?",
    bn: "কোন দিন থেকে?",
    pa: "ਕਿਹੜੇ ਦਿਨ ਤੋਂ?",
  },
  "Until which day?": {
    gu: "કયા દિવસ સુધી?",
    ta: "எந்த நாள் வரை?",
    te: "ఏ రోజు వరకు?",
    kn: "ಯಾವ ದಿನದವರೆಗೆ?",
    bn: "কোন দিন পর্যন্ত?",
    pa: "ਕਿਹੜੇ ਦਿਨ ਤੱਕ?",
  },
  "Which day did it start?": {
    gu: "કયા દિવસે શરૂ થયું?",
    ta: "எந்த நாளில் தொடங்கியது?",
    te: "ఏ రోజు ప్రారంభమైంది?",
    kn: "ಯಾವ ದಿನ ಪ್ರಾರಂಭವಾಯಿತು?",
    bn: "কোন দিন শুরু হয়েছিল?",
    pa: "ਕਿਹੜੇ ਦਿਨ ਸ਼ੁਰੂ ਹੋਇਆ?",
  },
  "Which day did it finish?": {
    gu: "કયા દિવસે પૂરું થયું?",
    ta: "எந்த நாளில் முடிந்தது?",
    te: "ఏ రోజు ముగిసింది?",
    kn: "ಯಾವ ದಿನ ಮುಗಿಯಿತು?",
    bn: "কোন দিন শেষ হয়েছিল?",
    pa: "ਕਿਹੜੇ ਦਿਨ ਖ਼ਤਮ ਹੋਇਆ?",
  },
  "How much?": {
    gu: "કેટલા રૂપિયા?",
    ta: "எவ்வளவு ரூபாய்?",
    te: "ఎంత రూపాయలు?",
    kn: "ಎಷ್ಟು ರೂಪಾಯಿ?",
    bn: "কত টাকা?",
    pa: "ਕਿੰਨੇ ਰੁਪਏ?",
  },
  "What is it for?": {
    gu: "શેના માટે?",
    ta: "எதற்காக?",
    te: "ఎందుకు?",
    kn: "ಯಾವುದಕ್ಕಾಗಿ?",
    bn: "কী জন্য?",
    pa: "ਕਿਸ ਲਈ?",
  },
  "How many litres of diesel?": {
    gu: "કેટલા લીટર ડીઝલ?",
    ta: "எத்தனை லிட்டர் டீசல்?",
    te: "ఎన్ని లీటర్ల డీజిల్?",
    kn: "ಎಷ್ಟು ಲೀಟರ್ ಡೀಸೆಲ್?",
    bn: "কত লিটার ডিজেল?",
    pa: "ਕਿੰਨੇ ਲੀਟਰ ਡੀਜ਼ਲ?",
  },
  "Paid or unpaid?": {
    gu: "પગાર સાથે કે વગર?",
    ta: "சம்பளத்துடனா இல்லையா?",
    te: "జీతంతోనా లేదా లేకుండానా?",
    kn: "ಸಂಬಳದೊಂದಿಗೆಯೇ ಅಥವಾ ಇಲ್ಲವೇ?",
    bn: "বেতনসহ না বেতন ছাড়া?",
    pa: "ਤਨਖ਼ਾਹ ਨਾਲ ਜਾਂ ਬਿਨਾਂ?",
  },
  "What is the customer's name?": {
    gu: "ગ્રાહકનું નામ શું છે?",
    ta: "வாடிக்கையாளரின் பெயர் என்ன?",
    te: "కస్టమర్ పేరు ఏమిటి?",
    kn: "ಗ್ರಾಹಕರ ಹೆಸರು ಏನು?",
    bn: "খদ্দেরের নাম কী?",
    pa: "ਗਾਹਕ ਦਾ ਨਾਮ ਕੀ ਹੈ?",
  },
  "What is their phone number?": {
    gu: "તેમનો ફોન નંબર શું છે?",
    ta: "அவர்களின் தொலைபேசி எண் என்ன?",
    te: "వారి ఫోన్ నంబర్ ఏమిటి?",
    kn: "ಅವರ ಫೋನ್ ನಂಬರ್ ಏನು?",
    bn: "তাঁর ফোন নম্বর কী?",
    pa: "ਉਹਨਾਂ ਦਾ ਫ਼ੋਨ ਨੰਬਰ ਕੀ ਹੈ?",
  },
  "What is the hour meter reading now?": {
    gu: "હમણાં આવર મીટર કેટલું છે?",
    ta: "இப்போது ஹவர் மீட்டர் எவ்வளவு?",
    te: "ఇప్పుడు అవర్ మీటర్ ఎంత?",
    kn: "ಈಗ ಅವರ್ ಮೀಟರ್ ಎಷ್ಟು?",
    bn: "এখন আওয়ার মিটার কত?",
    pa: "ਹੁਣ ਆਵਰ ਮੀਟਰ ਕਿੰਨਾ ਹੈ?",
  },
  "What was the hour meter at the end?": {
    gu: "કામ પછી આવર મીટર કેટલું હતું?",
    ta: "வேலை முடிந்ததும் ஹவர் மீட்டர் எவ்வளவு இருந்தது?",
    te: "పని తరువాత అవర్ మీటర్ ఎంత ఉంది?",
    kn: "ಕೆಲಸದ ನಂತರ ಅವರ್ ಮೀಟರ್ ಎಷ್ಟಿತ್ತು?",
    bn: "কাজের পরে আওয়ার মিটার কত ছিল?",
    pa: "ਕੰਮ ਤੋਂ ਬਾਅਦ ਆਵਰ ਮੀਟਰ ਕਿੰਨਾ ਸੀ?",
  },
  "What is the final hour meter reading?": {
    gu: "આખરી આવર મીટર કેટલું છે?",
    ta: "இறுதி ஹவர் மீட்டர் எவ்வளவு?",
    te: "చివరి అవర్ మీటర్ ఎంత?",
    kn: "ಕೊನೆಯ ಅವರ್ ಮೀಟರ್ ಎಷ್ಟು?",
    bn: "শেষ আওয়ার মিটার কত?",
    pa: "ਆਖ਼ਰੀ ਆਵਰ ਮੀਟਰ ਕਿੰਨਾ ਹੈ?",
  },
};
