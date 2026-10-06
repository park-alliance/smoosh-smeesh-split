from PIL import Image, ImageDraw

BG = (46, 158, 108)  # #2e9e6c, the app's accent green
SMOOSH = (63, 125, 224)  # #3f7de0
SMEESH = (214, 90, 154)  # #d65a9a
WHITE = (255, 255, 255)


def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    corner = round(size * 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner, fill=BG)

    # Two overlapping circles - Smoosh and Smeesh splitting something.
    r = size * 0.24
    cy = size * 0.5
    cx_left = size * 0.40
    cx_right = size * 0.60

    draw.ellipse([cx_left - r, cy - r, cx_left + r, cy + r], fill=SMOOSH)
    draw.ellipse([cx_right - r, cy - r, cx_right + r, cy + r], fill=SMEESH)

    # White divider through the overlap so the split reads clearly.
    divider_w = size * 0.035
    draw.rectangle(
        [size * 0.5 - divider_w / 2, cy - r * 0.95, size * 0.5 + divider_w / 2, cy + r * 0.95],
        fill=WHITE,
    )

    return img


for size in (192, 512):
    icon = make_icon(size)
    icon.save(rf"C:\Users\josep\coding projects\smoosh-smeesh-split\icon-{size}.png")

print("done")
