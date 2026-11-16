import pathlib,sys,zipfile,xml.etree.ElementTree as ET,collections,json
import pymupdf
root=pathlib.Path(sys.argv[1]);results=[]
P='{http://schemas.openxmlformats.org/presentationml/2006/main}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
for name in ['text.pptx','image.pptx','hidden.pptx','charts.pptx']:
 with zipfile.ZipFile(root/name) as package:
  for path in package.namelist():
   if path.endswith(('.xml','.rels')):ET.fromstring(package.read(path))
  slide=ET.fromstring(package.read('ppt/slides/slide1.xml'))
  ids=[node.attrib['id'] for node in slide.iter(P+'cNvPr')]
  assert len(ids)==len(set(ids)),(name,collections.Counter(ids))
  rels=ET.fromstring(package.read('ppt/slides/_rels/slide1.xml.rels'))
  targets={node.attrib['Id']:node.attrib['Target'] for node in rels}
  for node in slide.iter(A+'blip'):
   ref=node.attrib[R+'embed'];assert ref in targets,(name,ref)
   assert 'ppt/'+targets[ref].removeprefix('../') in package.namelist()
  if name=='hidden.pptx':assert b'HIDDEN_SENTINEL' not in package.read('ppt/slides/slide1.xml')
  results.append({'file':name,'validXml':True,'uniqueIds':True,'imageRelationshipsValid':True})
for name in ['headless.pdf','client.pdf']:
 pymupdf.TOOLS.mupdf_warnings(reset=True)
 with pymupdf.open(root/name) as pdf:
  page=pdf[0];pix=page.get_pixmap();samples=pix.samples
  red=sum(1 for i in range(0,len(samples),pix.n) if samples[i]>220 and samples[i+1]<40 and samples[i+2]<40)
  assert page.get_images(),name
  assert red>0,(name,red)
  warnings=pymupdf.TOOLS.mupdf_warnings(reset=True);assert not warnings,(name,warnings)
  results.append({'file':name,'imageResources':len(page.get_images()),'redPixels':red,'noParserWarnings':True})
(root/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
