from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import json


ROOT = Path(__file__).resolve().parents[1]
IMAGES_DIR = ROOT / "images"
LAYERS_DIR = ROOT / "layers"
MANIFEST_PATH = ROOT / "layers" / "manifest.json"
SIZE = 1000


PRESETS = {
    "aventurine.png": {
        "logo": [0.66, 0.01, 0.29, 0.16],
        "feather": 12,
        "shapes": [
            ("ellipse", [0.10, 0.02, 0.80, 0.50]),
            ("ellipse", [0.14, 0.28, 0.84, 0.96]),
            ("ellipse", [0.00, 0.52, 0.42, 0.98]),
            ("ellipse", [0.60, 0.22, 0.96, 0.92]),
        ],
    },
    "castorice.png": {
        "logo": [0.02, 0.02, 0.29, 0.16],
        "feather": 12,
        "shapes": [
            ("ellipse", [0.16, 0.00, 0.86, 0.48]),
            ("ellipse", [0.16, 0.22, 0.98, 0.92]),
            ("ellipse", [0.00, 0.42, 0.40, 0.98]),
            ("ellipse", [0.58, 0.42, 0.98, 0.98]),
        ],
    },
    "cyrene.png": {
        "logo": [0.66, 0.01, 0.28, 0.15],
        "feather": 12,
        "shapes": [
            ("ellipse", [0.10, 0.02, 0.82, 0.54]),
            ("ellipse", [0.18, 0.26, 0.88, 0.98]),
            ("ellipse", [0.00, 0.50, 0.40, 1.00]),
            ("ellipse", [0.58, 0.34, 0.98, 0.94]),
        ],
    },
    "firefly.png": {
        "logo": [0.02, 0.02, 0.28, 0.16],
        "feather": 12,
        "shapes": [
            ("ellipse", [0.12, 0.00, 0.88, 0.52]),
            ("ellipse", [0.16, 0.22, 0.90, 0.96]),
            ("ellipse", [0.00, 0.38, 0.36, 0.98]),
            ("ellipse", [0.62, 0.30, 1.00, 0.98]),
        ],
    },
    "kafka.png": {
        "logo": [0.67, 0.01, 0.28, 0.15],
        "feather": 12,
        "shapes": [
            ("ellipse", [0.12, 0.00, 0.86, 0.52]),
            ("ellipse", [0.14, 0.24, 0.88, 0.98]),
            ("ellipse", [0.00, 0.46, 0.42, 1.00]),
            ("ellipse", [0.56, 0.26, 1.00, 0.96]),
        ],
    },
    "phainon.png": {
        "logo": [0.02, 0.02, 0.28, 0.16],
        "feather": 12,
        "shapes": [
            ("ellipse", [0.14, 0.00, 0.86, 0.48]),
            ("ellipse", [0.14, 0.24, 0.88, 0.96]),
            ("ellipse", [0.00, 0.34, 0.44, 0.90]),
            ("ellipse", [0.56, 0.20, 1.00, 0.86]),
        ],
    },
    "ruan mei.png": {
        "logo": [0.67, 0.01, 0.28, 0.15],
        "feather": 12,
        "shapes": [
            ("ellipse", [0.14, 0.00, 0.86, 0.52]),
            ("ellipse", [0.16, 0.22, 0.88, 0.96]),
            ("ellipse", [0.00, 0.56, 0.34, 0.98]),
            ("ellipse", [0.62, 0.54, 1.00, 0.98]),
        ],
    },
}


def px_box(box):
    x, y, w, h = box
    return [
        int(round(x * SIZE)),
        int(round(y * SIZE)),
        int(round((x + w) * SIZE)),
        int(round((y + h) * SIZE)),
    ]


def shape_box(box):
    return [int(round(v * SIZE)) for v in box]


def build_subject_mask(preset):
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    for kind, box in preset["shapes"]:
        if kind == "ellipse":
            draw.ellipse(shape_box(box), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(radius=preset["feather"]))


def build_logo_mask(preset):
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(px_box(preset["logo"]), radius=18, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(radius=3))


def expanded_blur(image):
    expanded = image.resize((1060, 1060), Image.Resampling.LANCZOS)
    left = (expanded.width - SIZE) // 2
    top = (expanded.height - SIZE) // 2
    expanded = expanded.crop((left, top, left + SIZE, top + SIZE))
    return expanded.filter(ImageFilter.GaussianBlur(radius=18))


def subtract_mask(base_mask, cut_mask):
    base = base_mask.copy()
    base_data = base.load()
    cut_data = cut_mask.load()
    for y in range(SIZE):
        for x in range(SIZE):
            base_data[x, y] = max(0, base_data[x, y] - cut_data[x, y])
    return base


def main():
    LAYERS_DIR.mkdir(exist_ok=True)
    manifest = {}

    for name, preset in PRESETS.items():
        src_path = IMAGES_DIR / name
        out_dir = LAYERS_DIR / src_path.stem
        out_dir.mkdir(exist_ok=True)

        image = Image.open(src_path).convert("RGBA").resize((SIZE, SIZE))
        subject_mask = build_subject_mask(preset)
        logo_mask = build_logo_mask(preset)
        bg_keep = Image.new("L", (SIZE, SIZE), 255)
        bg_keep = subtract_mask(bg_keep, subject_mask)
        bg_keep = subtract_mask(bg_keep, logo_mask)

        subject = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        subject.paste(image, (0, 0), subject_mask)

        logo = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        logo.paste(image, (0, 0), logo_mask)

        bg_sharp = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        bg_sharp.paste(image, (0, 0), bg_keep)
        bg_fill = expanded_blur(image)
        background = Image.alpha_composite(bg_fill, bg_sharp)

        subject_mask.save(out_dir / "subject-mask.png")
        logo_mask.save(out_dir / "logo-mask.png")
        subject.save(out_dir / "subject.png")
        logo.save(out_dir / "logo.png")
        background.save(out_dir / "background.png")

        manifest[name] = {
            "background": f"./layers/{src_path.stem}/background.png",
            "subject": f"./layers/{src_path.stem}/subject.png",
            "logo": f"./layers/{src_path.stem}/logo.png",
        }

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
