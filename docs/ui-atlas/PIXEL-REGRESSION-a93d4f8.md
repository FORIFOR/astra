# Pixel regression — RC a93d4f8 vs de5d319 (existing faces only)

```
PIXEL_REGRESSION existing faces compared: 126 (same 76, time-dependent 38, nondeterministic 2, differ 10)
  meeting.preparing                    light   0.11%  66 px
  meeting.preparing                    dark    0.11%  66 px
  meeting.paused                       light   0.11%  66 px
  meeting.paused                       dark    0.11%  66 px
  meeting.captions                     light   0.02%  66 px
  meeting.captions                     dark    0.02%  66 px
  meeting.ask                          light   0.01%  51 px
  meeting.ask                          dark    0.01%  51 px
  meeting.workspace                    light   0.21%  1560 px  [time-dependent fixture]
  meeting.workspace                    dark    0.20%  1446 px  [time-dependent fixture]
  recording.meeting-canvas             light   0.30%  2167 px  [time-dependent fixture]
  main.home                            light   0.26%  2613 px  [time-dependent fixture]
  main.home                            dark    0.27%  2795 px  [time-dependent fixture]
  main.home-recording-now              light   0.15%  1525 px  [time-dependent fixture]
  main.home-recording-now              dark    0.15%  1529 px  [time-dependent fixture]
  main.home-upcoming                   light   2.95%  29995 px  [time-dependent fixture]
  main.home-upcoming                   dark   18.45%  187628 px  [time-dependent fixture]
  main.new-recording-sheet             light   1.89%  19246 px  [time-dependent fixture]
  main.new-recording-sheet             dark    2.42%  24603 px  [time-dependent fixture]
  main.work-tasks                      light   0.00%  0 px
  main.work-tasks                      dark    0.00%  0 px
  main.apps-plugins                    light   0.31%  3133 px  [nondeterministic fixture: プラグインのタイルの色が run ごとに変わる（並びは同じ）。色の種が順序の無い集合から来ている疑い。0.3〜0.5% の差。]
  main.apps-plugins                    dark    0.32%  3218 px  [nondeterministic fixture: プラグインのタイルの色が run ごとに変わる（並びは同じ）。色の種が順序の無い集合から来ている疑い。0.3〜0.5% の差。]
  main.scale-compact                   light   2.64%  26874 px  [time-dependent fixture]
  main.scale-compact                   dark   17.16%  174501 px  [time-dependent fixture]
  main.scale-comfortable               light   2.95%  29995 px  [time-dependent fixture]
  main.scale-comfortable               dark   18.45%  187628 px  [time-dependent fixture]
  main.scale-large                     light   4.19%  42629 px  [time-dependent fixture]
  main.scale-large                     dark   22.00%  223678 px  [time-dependent fixture]
  session.recording                    light   0.74%  7558 px  [time-dependent fixture]
  session.recording                    dark   13.11%  133320 px  [time-dependent fixture]
  session.processing                   light   2.03%  20610 px  [time-dependent fixture]
  session.processing                   dark   17.80%  181029 px  [time-dependent fixture]
  session.ready                        light   2.92%  29717 px  [time-dependent fixture]
  session.ready                        dark   18.44%  187492 px  [time-dependent fixture]
  session.project                      light   2.95%  29995 px  [time-dependent fixture]
  session.project                      dark   18.45%  187628 px  [time-dependent fixture]
  provenance.library-after-end         light   0.17%  1774 px  [time-dependent fixture]
  provenance.source                    light   0.17%  1774 px  [time-dependent fixture]
  provenance.reopened                  light   0.17%  1774 px  [time-dependent fixture]
  system.interrupted                   light   4.91%  49925 px  [time-dependent fixture]
  system.interrupted                   dark   27.95%  284227 px  [time-dependent fixture]
  system.interrupted-journey           light   0.35%  3536 px  [time-dependent fixture]
  system.resumed                       light   0.17%  1774 px  [time-dependent fixture]
  system.calendar-permission           light   0.26%  2613 px  [time-dependent fixture]
  system.calendar-permission           dark    0.27%  2795 px  [time-dependent fixture]
  system.accessibility-permission      light   0.26%  2613 px  [time-dependent fixture]
  system.accessibility-permission      dark    0.27%  2795 px  [time-dependent fixture]
  system.generic-failure               light   1.93%  19612 px  [time-dependent fixture]
  system.generic-failure               dark   14.13%  143671 px  [time-dependent fixture]
PIXEL_REGRESSION=PASS
```
