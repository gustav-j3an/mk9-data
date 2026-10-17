import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleMapsDirectionsUrl } from './googleMaps';

describe('buildGoogleMapsDirectionsUrl', () => {
  it('cria rota para a loja pelo nome e cidade/UF quando não há coordenadas próprias', () => {
    const result = buildGoogleMapsDirectionsUrl({
      name: 'ASSAI - TAGUATINGA SHOPPING',
      city: 'Brasília',
      uf: 'DF'
    });

    assert.ok(result);
    const url = new URL(result);
    assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('destination'), 'ASSAI - TAGUATINGA SHOPPING, Brasília/DF');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
    assert.equal(url.searchParams.has('origin'), false);
  });

  it('inclui nome e endereço completo no destino', () => {
    const result = buildGoogleMapsDirectionsUrl({
      name: 'Loja Central',
      address: 'Av. Principal, 100',
      city: 'Goiânia',
      uf: 'GO'
    });

    assert.ok(result);
    assert.equal(
      new URL(result).searchParams.get('destination'),
      'Loja Central, Av. Principal, 100, Goiânia/GO'
    );
  });

  it('permite pesquisar somente pelo nome e recusa abrir destino sem nome da loja', () => {
    const nameOnly = buildGoogleMapsDirectionsUrl({ name: 'Loja Central' });
    assert.ok(nameOnly);
    assert.equal(new URL(nameOnly).searchParams.get('destination'), 'Loja Central');
    assert.equal(buildGoogleMapsDirectionsUrl({ address: 'Rua Um, 10', city: 'Brasília' }), null);
    assert.equal(buildGoogleMapsDirectionsUrl({ name: '  ' }), null);
  });
});
