# Pixel regression — RC f3f3e9e vs de5d319 (existing faces only)

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
  meeting.workspace                    light   0.22%  1643 px  [time-dependent fixture]
  meeting.workspace                    dark    0.23%  1705 px  [time-dependent fixture]
  recording.meeting-canvas             light   0.00%  0 px  [time-dependent fixture]
  main.home                            light   0.06%  597 px  [time-dependent fixture]
  main.home                            dark    0.06%  609 px  [time-dependent fixture]
  main.home-recording-now              light   0.16%  1608 px  [time-dependent fixture]
  main.home-recording-now              dark    0.16%  1662 px  [time-dependent fixture]
  main.home-upcoming                   light   2.75%  27979 px  [time-dependent fixture]
  main.home-upcoming                   dark   18.24%  185442 px  [time-dependent fixture]
  main.new-recording-sheet             light   1.70%  17267 px  [time-dependent fixture]
  main.new-recording-sheet             dark    2.21%  22434 px  [time-dependent fixture]
  main.work-tasks                      light   0.00%  0 px
  main.work-tasks                      dark    0.00%  0 px
  main.apps-plugins                    light   0.26%  2623 px  [nondeterministic fixture: プラグインのタイルの色が run ごとに変わる（並びは同じ）。色の種が順序の無い集合から来ている疑い。0.3〜0.5% の差。]
  main.apps-plugins                    dark    0.31%  3171 px  [nondeterministic fixture: プラグインのタイルの色が run ごとに変わる（並びは同じ）。色の種が順序の無い集合から来ている疑い。0.3〜0.5% の差。]
  main.scale-compact                   light   2.48%  25210 px  [time-dependent fixture]
  main.scale-compact                   dark   16.98%  172685 px  [time-dependent fixture]
  main.scale-comfortable               light   2.75%  27979 px  [time-dependent fixture]
  main.scale-comfortable               dark   18.24%  185442 px  [time-dependent fixture]
  main.scale-large                     light   3.94%  40057 px  [time-dependent fixture]
  main.scale-large                     dark   21.73%  220996 px  [time-dependent fixture]
  session.recording                    light   0.74%  7558 px  [time-dependent fixture]
  session.recording                    dark   13.11%  133320 px  [time-dependent fixture]
  session.processing                   light   1.83%  18594 px  [time-dependent fixture]
  session.processing                   dark   17.59%  178843 px  [time-dependent fixture]
  session.ready                        light   2.72%  27701 px  [time-dependent fixture]
  session.ready                        dark   18.22%  185306 px  [time-dependent fixture]
  session.project                      light   2.75%  27979 px  [time-dependent fixture]
  session.project                      dark   18.24%  185442 px  [time-dependent fixture]
  provenance.library-after-end         light   0.23%  2345 px  [time-dependent fixture]
  provenance.source                    light   0.23%  2345 px  [time-dependent fixture]
  provenance.reopened                  light   0.23%  2345 px  [time-dependent fixture]
  system.interrupted                   light   4.71%  47909 px  [time-dependent fixture]
  system.interrupted                   dark   27.74%  282041 px  [time-dependent fixture]
  system.interrupted-journey           light   0.17%  1697 px  [time-dependent fixture]
  system.resumed                       light   0.23%  2345 px  [time-dependent fixture]
  system.calendar-permission           light   0.06%  597 px  [time-dependent fixture]
  system.calendar-permission           dark    0.06%  609 px  [time-dependent fixture]
  system.accessibility-permission      light   0.06%  597 px  [time-dependent fixture]
  system.accessibility-permission      dark    0.06%  609 px  [time-dependent fixture]
  system.generic-failure               light   1.83%  18580 px  [time-dependent fixture]
  system.generic-failure               dark   13.91%  141450 px  [time-dependent fixture]
PIXEL_REGRESSION=PASS
```
