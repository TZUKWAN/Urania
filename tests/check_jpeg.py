from PIL import Image
import sys

path = sys.argv[1]
im = Image.open(path)
im.load()
print('OK', im.size, im.mode, im.format)
