# Исследование: удары в настольном теннисе на десктопе и мобильных

Дата: 2026-10-24. Задача исследования — понять, какие удары реально
реализованы в существующих играх (кроме VR), какими жестами они делаются и
какие из них воспроизводимы пальцем/мышью у большинства людей. VR-игры
(Eleven Table Tennis, Real Table Tennis VR) намеренно исключены из вывода о
жестах: там удар — это физическое движение контроллера, а не линия на экране.
Они использованы только как источник данных о поведении мяча.

## 1. Что реализовано в существующих играх

| Игра | Удары | Как задаётся жест | Что важно для нас |
|---|---|---|---|
| Table Tennis Touch (Yakuto) | топспин, бэкспин, сайдспин, смэш, подача двух типов | свайп по мячу; скорость свайпа = сила; после контакта сдвиг вбок = вращение | самый цитируемый мобильный эталон; скорость+направление свайпа, без сложных фигур |
| Ping Pong Fury (Yakuto) | то же + «chop», подача-маятник | свайп; круговое движение для маятниковой подачи | круговой жест существует, но он редкий и опционален |
| Virtual Table Tennis 3D (Clapfoot) | топспин/бэкспин/сайдспин, смэш, «smashing serve» | палец двигает ракетку, направление свайпа задаёт полёт | ранняя и самая массовая схема «ракетка под пальцем» |
| Real Table Tennis 3D / Table Tennis Champion (Giraffe) | направление + сила + вращение | свайп в нужную сторону; тайминг критичен | ранний/поздний свайп → медленный мяч |
| Table Tennis 1v1 Online | топспин, chop, curve, смэш после заполнения шкалы | свайп вверх/вниз/вбок, закруглённый свайп | «curve» — единственный массовый двумерный жест |
| Threepon (браузер) | топспин, бэкспин, сайдспин | «pull down then up» для топспина, «up then flick down» для бэкспина, изгиб для сайдспина | пример того, как сложно объяснить глагол «сначала вниз, потом вверх» |
| Finals Night (браузер) | топспин, бэкспин, сайдспин | flick up / pull down / sideways | то же, что и выше, но проще |
| TT Table Tennis (adong, open source) | block, drive, topspin, backspin, curve, smash | неподвижная ракетка = block; быстрый свайп = drive; вверх/вниз/вбок = spin; высокий мяч = smash | автоматический block и автоматический smash; 6 исходов на 2 оси |
| Table Tennis Toon | accuracy, topspin, backspin, sidespin L/R | 5 отдельных кнопок-ударов | кнопочная схема вместо жестов (десктоп) |
| Rockstar Table Tennis | топспин, бэкспин, левый/правый спин + гибриды, focus-shot | 4 кнопки/стик, удержание = сила | 4 базовых вращения + комбинации — эталон десктопа |
| Wii Sports Resort Table Tennis | топспин, бэкспин, сайдспин, «booster» | наклон/взмах Wii Remote | наклон кисти → вращение, но это не переносится на палец |
| Lofi Ping Pong | простые направления + темп | свайп/тап в ритм | доказывает, что 4 направлений достаточно для аркады |
| spin-table-tennis (браузер) | приём вращений: топспин, бэкспин, боковой | драг + скорость; отдельная ось — наклон ракетки | показывает цену «второй оси»: нужен дополнительный контрол |
| Virtual Table Tennis (SenseDevil) | «различные способы удара и смэша» | позиция ракетки + свайп | маркетинг без конкретики; реально — направление и сила |
| Table Tennis 3D / Table Tennis (Giraffe) | направление и сила; тайминг | свайп | тайминг объявлен критическим, но ось одна |

Повторяющийся набор во всех играх: **направление свайпа**, **сила (скорость
или длина свайпа)** и **тайминг**. Вращение почти всегда — производная
направления: вверх = топспин, вниз = бэкспин, вбок = сайдспин. Только
Table Tennis Touch/Ping Pong Fury и Table Tennis 1v1 добавляют второй жест
(сдвиг после контакта или изгиб линии), и во всех обзорах это описывается как
«сложно, но осваивается».

## 2. Удары реального настольного тенниса

Фундаментальные удары (ITTF-терминология и тренерские руководства): drive,
loop (топспин), push, chop, block, flick, smash, lob, drop shot. Из них:

- **loop / topspin** — движение снизу-вверх, закрытая ракетка;
- **push / chop / backspin** — движение сверху-вниз, открытая ракетка;
- **drive** — плоское быстрое движение вперёд;
- **smash** — короткое резкое движение по высокому мячу;
- **block** — почти без замаха, ракетка просто стоит;
- **flick** — короткое кистевое движение по короткому мячу;
- **lob** — длинное движение снизу-вверх с высокой траекторией.

С точки зрения одной линии на экране различаются только две оси:
вертикальная (верхнее/нижнее вращение) и горизонтальная (боковое вращение),
плюс амплитуда (сила) и момент (тайминг). Flick, block, drop и lob не
образуют отдельного направления — это те же движения с другой амплитудой
и/или по другой высоте мяча. Именно поэтому 8 направлений (4 стороны + 4
диагонали) — естественный предел: диагональ = комбинация верх/низ + бок.

## 3. Воспроизводимость жестов пальцем и мышью

- Распознавание 8 направлений свайпа — решённая задача: в исследованиях
  точность 82–100 % на прямых линиях; хуже всего даются диагонали влево-вверх
  и чисто горизонтальные (82 %), лучше — диагонали вправо-вниз (100 %).
- Минимальная длина свайпа в разных платформах — 20–50 px; практические
  пороги 100–200 px дают меньше ложных срабатываний. Следовательно, жест
  должен требовать заметного, но короткого перемещения.
- Средняя длительность: тап ~133 мс, свайп вбок ~421 мс, сложный жест ~900 мс.
  Значит, распознавание не должно ждать окончания длинного жеста.
- Палец закрывает область вокруг точки касания; обратная связь под пальцем
  бесполезна. Поэтому зона удара не подсвечивается, а результат показывается
  в стороне (HUD сверху/снизу).
- Оптимальная цель касания 44–48 CSS px, а комфортная зона для большого
  пальца — нижняя треть экрана; верхняя треть требует перехвата.
- Реакция человека 200–300 мс, у теннисистов ~200 мс; плюс задержка
  тачскрина 12–100 мс. Значит, окно «идеального» момента должно быть не
  меньше ~200 мс, иначе игра непроходима.
- Круговые/изогнутые жесты (pendulum, curve) требуют в 2–3 раза больше
  времени и дают заметно худшую воспроизводимость; в массовых играх они
  опциональны или отсутствуют.

## 4. Вывод для этой игры

1. Оставить **ровно 8 направлений**: ↑, ↓, ←, →, ↖, ↗, ↙, ↘.
2. Вращение — из направления: ↑ топспин, ↓ подрезка, ←/→ боковое,
   диагонали — комбинации. Никаких «сначала вниз, потом вверх».
3. Сила — из **длины** свайпа (не из скорости): длина стабильнее, не зависит
   от FPS и от того, насколько резко дёрнули палец. Три полосы: слабый,
   обычный, сильный. Слабый не долетает до сетки, сильный улетает за стол —
   это и есть калибровочные режимы отказа.
4. Тайминг — по положению мяча, окно окрашивается: белый (рано) → зелёный
   (можно бить) → красный (поздно). Окно ≥ 250 мс.
5. Начало жеста должно попадать в зону вокруг мяча (экранный радиус), затем
   линия классифицируется по ближайшему из 8 направлений; кривая линия
   выпрямляется к ближайшему направлению.
6. Подача — отдельное решение игрока: направление (лево/центр/право) и тип
   вращения задаются заранее, а не чередуются автоматически. Это упрощает
   калибровку: игрок знает, чего ждать.
7. Никаких удержаний, кнопок удара, двойных тапов и второй оси наклона
   ракетки: они либо не воспроизводимы пальцем, либо конфликтуют со свайпом.

## 5. Источники

Игры и их управление:

1. Threepon — https://threepon.pages.dev/
2. Table Tennis: 1v1 Online — https://tabletennis1v1.online/
3. Finals Night — https://dubai-red-ten.vercel.app/
4. TT Table Tennis (adong) — https://github.com/adong/tt-table-tennis
5. Table Tennis Online (playboardgames) — https://playboardgames.org/play/table-tennis
6. Table Tennis Touch, Grokipedia — https://grokipedia.com/page/table_tennis_touch
7. Table Tennis Touch, Google Play — https://play.google.com/store/apps/details?id=uk.co.yakuto.TableTennisTouch
8. Table Tennis Touch, App Store — https://apps.apple.com/us/app/id860620713
9. Table Tennis Touch review, PocketGamer — https://www.pocketgamer.com/articles/059551/table-tennis-touch/
10. Table Tennis Touch review, AppSpy — https://www.appspy.com/table-tennis-touch/review/
11. Table Tennis Touch review, 148Apps — https://www.148apps.com/table-tennis-touch/table-tennis-touch-review/
12. Table Tennis Touch review, TapSmart — https://www.tapsmart.com/games/review-table-tennis-touch/
13. Table Tennis Touch, Uptodown — https://table-tennis-touch.en.uptodown.com/android
14. Table Tennis Touch, Android Police — https://www.androidpolice.com/2015/03/13/table-tennis-touch-serves-up-fast-paced-ping-pong-fun-in-the-play-store/
15. Table Tennis Touch: three things to know — https://www.pocketgamer.com/table-tennis-touch/table-tennis-touch-three-things-to-know/
16. Table Tennis Touch, Reddit review — https://www.reddit.com/r/AndroidGaming/comments/507t3q/table_tennis_touch_a_10_and_5_review_10_good/
17. Ping Pong Fury, Google Play — https://play.google.com/store/apps/details?id=uk.co.yakuto.PingPongKing
18. Ping Pong Fury, support (balls/spin) — https://support.pingpongfury.com/hc/en-us/articles/360010898197-How-do-balls-affect-gameplay-
19. Ping Pong Fury, Reddit strategy — https://www.reddit.com/r/PingPongFury/comments/oshf0g/after_a_long_grind_we_finally_made_it_bois/
20. Virtual Table Tennis 3D, Google Play — https://play.google.com/store/apps/details?id=com.clapfootgames.vtt3dfree
21. Virtual Table Tennis 3D Pro, Google Play — https://play.google.com/store/apps/details?id=com.clapfootgames.vtt3d
22. Virtual Table Tennis 3D review, All About Symbian — https://allaboutsymbian.com/reviews/item/12681_Virtual_Table_Tennis_3D.php
23. Virtual Table Tennis 3D, download.it — https://virtual-table-tennis-3d.en.download.it/android
24. Virtual Table Tennis 3D, Uptodown — https://virtual-table-tennis-3d.en.uptodown.com/android
25. Virtual Table Tennis 3D, BlueStacks — https://www.bluestacks.com/apps/sports/virtual-table-tennis-3d-pro-on-pc.html
26. Virtual Table Tennis (SenseDevil), PGYER — https://www.pgyer.com/apk/apk/com.sensedevil.VTT
27. Real Table Tennis 3D, appstor.io — https://real-table-tennis-3d.appstor.io/
28. Real Table Tennis, Softonic — https://real-table-tennis.en.softonic.com/android
29. Real Table Tennis, APKCombo — https://apkcombo.app/real-table-tennis/com.giraffegames.realtabletennis/
30. Table Tennis 3D, Google Play — https://play.google.com/store/apps/details?id=com.giraffegames.tabletennis
31. Table Tennis Champion, App Store — https://apps.apple.com/us/app/table-tennis-champion/id1042301628
32. Table Tennis (Giraffe), Google Play — https://play.google.com/store/apps/details?id=com.giraffegames.tabletennis3d
33. Ping Pong Masters, Google Play — https://play.google.com/store/apps/details?id=com.clapfootgames.tabletennis
34. Table Tennis Toon, Steam — https://store.steampowered.com/app/2713750/Table_Tennis_Toon/
35. Top Tennis, how to play — https://toptennisgame.com/how-to-play/
36. Lofi Ping Pong / best ping pong games, Racket Insight — https://racketinsight.com/table-tennis/best-ping-pong-games/
37. Wii Sports Resort Table Tennis, Fandom — https://wiisports.fandom.com/wiki/Table_Tennis_(Wii_Sports_Resort)
38. Wii Sports Resort Table Tennis, IGN — https://www.ign.com/wikis/wii-sports-resort/Table_Tennis_Match
39. Rockstar Table Tennis controls, StrategyWiki — https://strategywiki.org/wiki/Rockstar_Games_presents_Table_Tennis/Controls
40. Rockstar Table Tennis, IGN hands-on (Wii) — https://www.ign.com/articles/2007/09/25/rockstar-table-tennis-hands-on
41. Rockstar Table Tennis, GameSpot review — https://www.gamespot.com/reviews/rockstar-games-presents-table-tennis-review/1900-6151794/
42. Rockstar Table Tennis, Eurogamer review — https://www.eurogamer.net/r-tabletennis-x360
43. Rockstar Table Tennis, GameFAQs review — https://gamefaqs.gamespot.com/wii/942164-rockstar-games-presents-table-tennis/reviews/136532
44. spin-table-tennis (браузер, Китай) — https://github.com/huangluke89757/spin-table-tennis
45. 虚拟乒乓球, гайд — https://www.32r.com/app/97726.html
46. 真实乒乓球 (Table Tennis ReCrafted) — https://www.32r.com/app/133544.html
47. Smashphone — https://smashphone.app/table-tennis
48. Table Tennis Game, ZapGames — https://zapgames.io/table-tennis-game
49. Free ping pong games list — https://www.lilachbullock.com/free-ping-pong-games/

Техника ударов, правила и физика:

50. Types of shots, PingPong Fandom — https://pingpong.fandom.com/wiki/Types_of_shots
51. Table tennis coach: strokes — https://www.tabletenniscoach.me.uk/how-to-play/
52. Racket Insiders: shots in table tennis — https://racketinsiders.com/shots-in-table-tennis/
53. Topspin11: fundamentals + RPM — https://topspin11.com/techniques/strokes/
54. Glossary of table tennis (Wikipedia) — https://en.wikipedia.org/wiki/Glossary_of_table_tennis
55. USATT terminology — https://stason.org/TULARC/sports/table-tennis/1-2-Table-Tennis-Terminology.html
56. ITTF serve rules / how to serve — https://tabletennisteacher.com/serves/
57. ITTF 2.06 serve rules, PingPong King — https://www.pingpong-king.com/blog/how-to-serve-in-ping-pong
58. Returning spin, PingSkills — https://www.pingskills.com/table-tennis-forum/returning-side-spin-chop-serve
59. Effect of spin on returns, Topspin11 — https://topspin11.com/science/spin/
60. Masatenisi: spin — https://www.masatenisi.org/english/spin.htm
61. Effects of technical-tactical skills (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC9932731

Жесты, эргономика, тайминг:

62. Swipe distance thresholds — https://swipedistance-3655da.gitlab.io/
63. 8-Straight Line Directions Recognition Algorithm (82–100 %) — https://www.researchgate.net/publication/283699923_8-Straight_Line_Directions_Recognition_Algorithm_for_Hand_Gestures_Using_Coordinate_Information
64. SwipeSense, ACM (8 directions, 72–95 %) — https://dl.acm.org/doi/full/10.1145/3743734
65. Touch controls for mobile games (swipe thresholds) — https://cursa.app/en/page/touch-controls-for-mobile-games-input-patterns-and-feedback
66. Implementing swipe gestures (100–200 px, 100–300 px/s) — https://reintech.io/blog/implementing-swipe-gestures-android-gesture-detectors
67. Gesture-based interfaces with touch handling — https://www.johal.in/designing-gesture-based-interfaces-with-touch-handling
68. Target sizes, UXPin — https://www.uxpin.com/studio/blog/responsive-design-touch-devices-key-considerations/
69. WCAG 2.5.5 target size — https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
70. Thumb occlusion, wandr.studio — https://www.wandr.studio/blog/mobile-game-ui-design
71. Thumb zones — https://timgraf.com/ux-design/designing-for-the-thumb-zone-a-modern-guide-to-mobile-ux-that-respects-human-anatomy/
72. Fitts's law on mobile — https://evelance.io/blog/fittss-law-touch-target-sizing-mobile/
73. Fingertip forces and gesture completion time (133 ms tap / 421 ms slide) — https://www.sciencedirect.com/science/article/abs/pii/S1050641116301225
74. Tablet form factors and swipe design — https://www.sciencedirect.com/science/article/am/pii/S0003687017302818
75. Reaction time benchmarks — https://ndcswift.github.io/tapduel/what-is-a-good-reaction-time/
76. Reaction time in sports (table tennis ~200 ms) — https://reactscore.com/blog/reaction-time-in-sports/
77. Visual reaction time of table tennis players — https://www.researchgate.net/publication/263514323_A_comparative_study_of_visual_reaction_time_in_table_tennis_players_and_healthy_controls
78. Touch latency and user perception — https://link.springer.com/chapter/10.1007/978-3-319-20681-3_13
79. Superior response speed of table tennis players (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC9126139/
80. VR table tennis skill transfer (PLOS ONE) — https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0222351

## 6. Ограничения исследования

- Часть страниц — магазины приложений и обзоры, а не первоисточники
  разработчиков: формулировки о жестах в них могут быть упрощены.
- Кривые жесты (curve/pendulum) есть в 3–4 играх, но ни в одной нет данных,
  какой процент игроков их осваивает; вывод об их сложности основан на
  длительности выполнения и на том, что они вынесены в опциональные приёмы.
- Точность распознавания 8 направлений измерялась на прямых линиях; для
  коротких «кривых» свайпов пальцем она будет ниже, поэтому в игре линия
  выпрямляется к ближайшему из 8 направлений, а не классифицируется как есть.
