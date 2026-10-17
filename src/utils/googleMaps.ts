export interface StoreMapDestination {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  uf?: string | null;
}

export const buildGoogleMapsDirectionsUrl = ({
  name,
  address,
  city,
  uf
}: StoreMapDestination): string | null => {
  const storeName = name?.trim();
  if (!storeName) return null;

  const cityAndUf = [city?.trim(), uf?.trim()].filter(Boolean).join('/');
  const destination = [storeName, address?.trim(), cityAndUf].filter(Boolean).join(', ');
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', destination);
  url.searchParams.set('travelmode', 'driving');
  return url.toString();
};
