/* 今日の名言（日付から自動で1つ選ばれます）
 * t: 名言本文 / ja: 日本語訳 / by: 人物 / src: 作品名など / lang: 言語コード(読み上げ用)
 * ※ 記憶に基づく収録です。表記ゆれや出典の違いがあり得ます。
 * ※ スプレッドシートに「名言」シート（A:名言 B:日本語訳 C:人物 D:出典 E:言語コード）を作ると、ここに追加されます。
 */
window.QUOTES = [
  // ---- スポーツ ----
  { t: "I've failed over and over and over again in my life. And that is why I succeed.", ja: "私は人生で何度も何度も失敗してきた。だからこそ成功するんだ。", by: "Michael Jordan", src: "Nike CM", lang: "en" },
  { t: "Rest at the end, not in the middle.", ja: "休むのは真ん中じゃない。最後だ。", by: "Kobe Bryant", src: "", lang: "en" },
  { t: "Everything negative – pressure, challenges – is all an opportunity for me to rise.", ja: "プレッシャーや困難といった否定的なものはすべて、自分が高みへ上がるチャンスだ。", by: "Kobe Bryant", src: "", lang: "en" },
  { t: "I hated every minute of training, but I said, 'Don't quit. Suffer now and live the rest of your life as a champion.'", ja: "トレーニングは1分1秒が嫌だった。でもこう言い聞かせた。「やめるな。今苦しめ。そして残りの人生をチャンピオンとして生きろ」", by: "Muhammad Ali", src: "", lang: "en" },
  { t: "You have to fight to reach your dream. You have to sacrifice and work hard for it.", ja: "夢に届くには戦わなければならない。犠牲を払い、懸命に努力しなければならない。", by: "Lionel Messi", src: "", lang: "en" },
  { t: "Talent without working hard is nothing.", ja: "努力のない才能は何の意味もない。", by: "Cristiano Ronaldo", src: "", lang: "en" },
  { t: "I really think a champion is defined not by their wins but by how they can recover when they fall.", ja: "チャンピオンは勝利の数ではなく、転んだときにどう立ち直るかで決まると思う。", by: "Serena Williams", src: "", lang: "en" },
  { t: "I won almost 80% of my matches, but only 54% of the points.", ja: "試合の勝率は約80%。でも、取ったポイントは54%にすぎない。", by: "Roger Federer", src: "Dartmouth 卒業式スピーチ", lang: "en" },
  { t: "You can't put a limit on anything. The more you dream, the farther you get.", ja: "何にも限界を設けてはいけない。夢を見るほど、遠くまで行ける。", by: "Michael Phelps", src: "", lang: "en" },
  { t: "I like criticism. It makes you strong.", ja: "批判は好きだ。人を強くしてくれるから。", by: "LeBron James", src: "", lang: "en" },
  { t: "Everyone has a plan until they get punched in the mouth.", ja: "誰もが計画を持っている。口を殴られるまではな。", by: "Mike Tyson", src: "", lang: "en" },
  { t: "The last three or four reps is what makes the muscle grow.", ja: "筋肉を成長させるのは、最後の3、4回だ。", by: "Arnold Schwarzenegger", src: "Pumping Iron", lang: "en" },
  { t: "I fear not the man who has practiced 10,000 kicks once, but I fear the man who has practiced one kick 10,000 times.", ja: "1万種類の蹴りを1回ずつ練習した者は恐れない。1種類の蹴りを1万回練習した者を恐れる。", by: "Bruce Lee", src: "", lang: "en" },
  { t: "Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing.", ja: "成功は偶然ではない。努力、忍耐、学び、犠牲、そして何より、自分のしていることへの愛だ。", by: "Pelé", src: "", lang: "en" },
  { t: "小さなことを積み重ねることが、とんでもないところへ行くただ一つの道だと思っています。", ja: "Small things, piled up, are the only road to the extraordinary.", by: "イチロー", src: "", lang: "ja" },
  { t: "憧れるのをやめましょう。", ja: "Let's stop admiring them.", by: "大谷翔平", src: "WBC 2023 決勝前", lang: "ja" },

  // ---- ドラマ・映画 ----
  { t: "I am the one who knocks!", ja: "俺はノックする側の人間だ！", by: "Walter White", src: "Breaking Bad", lang: "en" },
  { t: "Say my name.", ja: "俺の名前を言え。", by: "Walter White", src: "Breaking Bad", lang: "en" },
  { t: "I did it for me. I liked it. I was good at it. And I was really... I was alive.", ja: "自分のためにやった。好きだった。上手かった。そして…生きている実感があった。", by: "Walter White", src: "Breaking Bad", lang: "en" },
  { t: "Chemistry is, well, technically, chemistry is the study of matter. But I prefer to see it as the study of change.", ja: "化学とは、厳密には物質の学問だ。だが私は『変化』の学問だと思っている。", by: "Walter White", src: "Breaking Bad", lang: "en" },
  { t: "Yeah, science!", ja: "ああ、科学だぜ！", by: "Jesse Pinkman", src: "Breaking Bad", lang: "en" },
  { t: "No half measures.", ja: "中途半端はなしだ。", by: "Mike Ehrmantraut", src: "Breaking Bad", lang: "en" },
  { t: "If you're committed enough, you can make any story work.", ja: "本気で貫けば、どんな話でも通用させられる。", by: "Jimmy McGill", src: "Better Call Saul", lang: "en" },
  { t: "It's all good, man!", ja: "すべて問題なしさ！", by: "Saul Goodman", src: "Breaking Bad", lang: "en" },
  { t: "Hello, you.", ja: "やあ、君。", by: "Joe Goldberg", src: "YOU", lang: "en" },
  { t: "It ain't about how hard you hit. It's about how hard you can get hit and keep moving forward.", ja: "どれだけ強く打つかじゃない。どれだけ打たれても前に進み続けられるかだ。", by: "Rocky Balboa", src: "Rocky Balboa", lang: "en" }
];

