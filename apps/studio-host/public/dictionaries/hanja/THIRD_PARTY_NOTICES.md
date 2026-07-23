# Hanja database third-party notices

HOP source code remains licensed under the repository's MIT license. The generated data files in this directory contain third-party dictionary data and have the separate terms below.

## `characters.json` and `readings.json`

### libhangul `hanja.txt`

Source: <https://github.com/libhangul/libhangul/blob/a34aef73378c0992316861bbf13fc914ee7577d9/data/hanja/hanja.txt>

This notice applies to `characters.json`, `readings.json`, and the libhangul-derived portions of `words-*.json`.

Copyright (c) 2005,2006 Choe Hwanjin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the author nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### Unicode Unihan 17.0.0

Source: <https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip>
License: <https://www.unicode.org/license.txt>

UNICODE LICENSE V3 COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a copy of data files and any associated documentation (the "Data Files") or software and any associated documentation (the "Software") to deal in the Data Files or Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sell copies of the Data Files or Software, and to permit persons to whom the Data Files or Software are furnished to do so, provided that either (a) this copyright and permission notice appear with all copies of the Data Files or Software, or (b) this copyright and permission notice appear in associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall not be used in advertising or otherwise to promote the sale, use or other dealings in these Data Files or Software without prior written authorization of the copyright holder.

## `words-*.json`

The word database combines and modifies the libhangul mapping above with the Korean Basic Dictionary and Standard Korean Language Dictionary data described below. The combined word database is distributed under CC BY-SA 2.0 KR.

### 국립국어원 한국어기초사전

- 자료 제공: 국립국어원 한국어기초사전
- 원본: 2026-07-19 한국어기초사전 전체 내려받기(JSON)
- 출처: <https://krdict.korean.go.kr/download/downloadPopup?lang=ko>
- 이용 조건: 저작자표시-동일조건변경허락 2.0 대한민국 (CC BY-SA 2.0 KR)
- 이용 조건 전문: <https://creativecommons.org/licenses/by-sa/2.0/kr/>
- 국립국어원 저작권 정책: <https://krdict.korean.go.kr/kor/kboardPolicy/copyRightTermsInfo>

HOP converts the source entries into a Hangul-to-Hanja lookup schema, merges duplicate candidates, retains selected definitions/parts of speech/vocabulary levels, and shards the result by the first Hangul syllable. These are modifications of the source data, not an official National Institute of Korean Language publication.

### 국립국어원 표준국어대사전

- 자료 제공: 국립국어원 표준국어대사전
- 원본: 2026-06-05 표준국어대사전 전체 내려받기(XML)
- 공식 출처: <https://stdict.korean.go.kr/>
- 재현용 공개 스냅샷: <https://github.com/spellcheck-ko/korean-dict-nikl/tree/42c0d01889f34536e9cf94fe57f62bd2055b1bde/stdict>
- 이용 조건: 저작자표시-동일조건변경허락 2.0 대한민국 (CC BY-SA 2.0 KR)
- 국립국어원 저작권 정책: <https://stdict.korean.go.kr/join/copyrightPolicy.do>

HOP excludes phrases, idioms, proverbs, entries containing spacing markers, definitions, examples, and multimedia. It retains only dictionary units classified as words whose Hangul lemma and Hanja-containing origin have an exact one-character-to-one-character correspondence. The compact supplement is stored in `assets/dictionaries/hanja/stdict-20260605.json` and is itself a modified CC BY-SA 2.0 KR database.
