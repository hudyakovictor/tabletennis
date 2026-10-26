import json, sys
d = json.load(open(sys.argv[1])); g = d['grid']
xs = sorted(set(r['dx'] for r in g)); ys = sorted(set(r['dy'] for r in g)); m = {(r['dx'], r['dy']): r for r in g}
print('# = отбил на стол, + = контакт, . = иногда. Смещение пальца от точки встречи мяча с ракеткой (CSS px): строки dy (+ ниже), столбцы dx')
print('   dy\\dx ' + ''.join(f'{x:>6}' for x in xs))
for y in ys: print(f'{y:>8} ' + ''.join((' ' if m[(x,y)]['hit']==0 else '#' if m[(x,y)]['ok']>=.67 else '+' if m[(x,y)]['hit']>=.67 else '.').rjust(6) for x in xs))
print('тайминг (сдвиг жеста, с: + раньше, − позже): ' + ' '.join(f"{r['lead']:+.2f}:{'#' if r['ok']>=.67 else '+' if r['hit']>=.67 else '.' if r['hit']>0 else '_'}" for r in d['timing']))

print('зона нажатия (I=внутри овала, o=снаружи):')
for y in ys: print(f'{y:>8} ' + ''.join(('I' if m[(x,y)]['zone'].get('IN',0)>=2 else 'o').rjust(6) for x in xs))
