# Third-party notices

Bridge includes code adapted from the MIT-licensed projects below. Each adapted file carries a
header naming its copyright holders and pointing to this file.

## Sessions sidebar (Michael Yong and Yusuf Akbulut)

A sessions sidebar released under the MIT License by Michael Yong and Yusuf Akbulut. Bridge adapts
its logic and text in these files:

| File here | What is adapted |
|---|---|
| `hooks/relative-time.ts` | The relative age label (unchanged but for style) |
| `hooks/project-colors.ts` | The color hash and distinct-color assignment (without the React style helpers) |
| `hooks/core/icons.ts` | The project icon candidate files and the monogram letter rule |
| `hooks/core/lifecycle.ts` | The shelf and inactivity rules |
| `hooks/core/snooze.ts` | The snooze presets |
| `hooks/core/order.ts` | Moving a pinned card by an offset |
| `hooks/core/captions.ts` | The working captions |
| `hooks/core/age.ts` | The snooze time-left label |
| `hooks/core/tickets.ts` | The ticket id reader |
| `hooks/core/sprites.ts` | The working-scene creature, redrawn |
| `tests/cards.test.ts` | The relative-time and project-color test cases |

The card layout, shelves and status words follow the same design.

```
MIT License

Copyright (c) 2026 Michael Yong
Copyright (c) 2026 Yusuf Akbulut

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## T3 Code (T3 Tools Inc.)

[T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc. is the design and interaction
reference of the sidebar design above. T3 Code is released under the MIT License.

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Chime 0.1.0 (Chime contributors)

The tone math and the "minimal-question" sound definition in `hooks/core/chime.ts` are adapted from
Chime 0.1.0 (`scripts/generate-sounds.mjs`). No audio files are copied; the sound is rendered at
run time. Chime is released under the MIT License.

```
MIT License

Copyright (c) 2026 Chime contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
