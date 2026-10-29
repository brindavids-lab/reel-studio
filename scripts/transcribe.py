"""Word-level transcription with faster-whisper. Writes words.json next to the video.

Usage: python transcribe.py <video> <out.json> [model]
"""
import json
import sys

from faster_whisper import WhisperModel

video, out = sys.argv[1], sys.argv[2]
model_name = sys.argv[3] if len(sys.argv) > 3 else "small"

model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, info = model.transcribe(video, word_timestamps=True, vad_filter=True)

words = []
for seg in segments:
    for w in seg.words or []:
        text = w.word.strip()
        if text:
            words.append({"text": text, "start": round(w.start, 3), "end": round(w.end, 3)})

with open(out, "w", encoding="utf-8") as f:
    json.dump({"language": info.language, "model": model_name, "words": words}, f, ensure_ascii=False, indent=2)

print(f"{len(words)} words, language={info.language}")
