import { MAPS, drawPreview } from './maps.js';

/**
 * The map picker. Doubles as the title screen on first load and as a mid-flight
 * menu (M). Cards are built once; the previews are drawn from the same config
 * the world builder uses.
 */
export class MapMenu {
  constructor(onPick) {
    this.root = document.getElementById('menu');
    this.list = document.getElementById('map-list');
    this.title = document.getElementById('menu-title');
    this.onPick = onPick;
    this.open = true;
    this.current = null;

    for (const map of MAPS) {
      const card = document.createElement('button');
      card.className = 'map-card';
      card.type = 'button';

      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 140;
      canvas.className = 'map-prev';
      drawPreview(canvas, map);
      card.appendChild(canvas);

      const meta = document.createElement('div');
      meta.className = 'map-meta';
      const name = document.createElement('span');
      name.className = 'map-name';
      name.textContent = map.name;
      const diff = document.createElement('span');
      diff.className = `map-diff ${map.difficulty.toLowerCase()}`;
      diff.textContent = map.difficulty;
      meta.append(name, diff);
      card.appendChild(meta);

      const blurb = document.createElement('p');
      blurb.className = 'map-blurb';
      blurb.textContent = map.blurb;
      card.appendChild(blurb);

      card.addEventListener('click', () => this.pick(map));
      this.list.appendChild(card);
      map._card = card;
    }
  }

  pick(map) {
    if (this.current) this.current._card.classList.remove('active');
    this.current = map;
    map._card.classList.add('active');
    this.hide();
    this.onPick(map);
  }

  show(titleText = 'Choose a target') {
    this.title.textContent = titleText;
    this.root.classList.remove('gone');
    this.open = true;
  }

  hide() {
    this.root.classList.add('gone');
    this.open = false;
  }
}
