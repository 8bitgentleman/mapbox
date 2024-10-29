import { useEffect, useState } from "react";
import { Polyline, useMap, Marker, Popup } from "react-leaflet";
import axios from "axios";
import { LatLng, Icon, LatLngBounds } from "leaflet";
import extractTag from "roamjs-components/util/extractTag";
import { TreeNode } from "roamjs-components/types";

const MAPBOX_TOKEN = "pk.eyJ1IjoiZHZhcmdhczkyNDk1IiwiYSI6ImNraWYycDExbjAxZ3oycHFwcW51YzVkOXQifQ.snYquuD4M5yAor3cyMGtdA";

// Standard marker icon
const MarkerIcon = new Icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Location = {
  name: string;
  coordinates: [number, number];
  uid?: string;
};

interface MapboxDirectionsResponse {
  routes: Array<{
    geometry: {
      coordinates: Array<[number, number]>;
      type: string;
    };
    distance: number;
    duration: number;
  }>;
  code: string;
  waypoints: Array<{
    location: [number, number];
    name: string;
  }>;
}

const getCoordinatesForLocation = async (locationName: string): Promise<[number, number] | null> => {
  try {
    const response = await axios.get(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationName)}.json?access_token=${MAPBOX_TOKEN}`
    );

    if (!response.data.features?.length) {
      console.error(`No coordinates found for location: ${locationName}`);
      return null;
    }

    const [lng, lat] = response.data.features[0].center;
    return [lat, lng]; // Convert to [lat, lng] format
  } catch (error) {
    console.error(`Error geocoding location ${locationName}:`, error);
    return null;
  }
};

const getLocationsFromNodes = async (nodes: TreeNode[]): Promise<Location[]> => {
  const locations: Location[] = [];
  
  for (const node of nodes) {
    const locationName = extractTag(node.text.trim());
    const coordMatch = node.children?.[0]?.text.match(/([-\d.]+),\s*([-\d.]+)/);
    
    let coords: [number, number] | null;
    if (coordMatch) {
      coords = [parseFloat(coordMatch[1]), parseFloat(coordMatch[2])];
    } else {
      coords = await getCoordinatesForLocation(locationName);
    }
    
    if (coords) {
      locations.push({
        name: locationName,
        coordinates: coords,
        uid: node.uid
      });
    }
  }

  return locations;
};

const getRouteCoordinates = async (locations: Location[]): Promise<LatLng[]> => {
  if (locations.length < 2) return [];
  
  // Mapbox expects coordinates in longitude,latitude format
  const coordinates = locations.map(loc => `${loc.coordinates[1]},${loc.coordinates[0]}`).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
  
  try {
    const response = await axios.get<MapboxDirectionsResponse>(url);
    
    if (response.data.code !== 'Ok' || !response.data.routes?.[0]?.geometry?.coordinates) {
      console.error('Invalid response from Mapbox:', response.data);
      return [];
    }

    // Convert coordinates from [lng, lat] to [lat, lng] format for Leaflet
    return response.data.routes[0].geometry.coordinates.map(
      coord => new LatLng(coord[1], coord[0])
    );
  } catch (error) {
    console.error('Error fetching route:', error);
    return [];
  }
};

const LocationMarkers = ({ locations }: { locations: Location[] }): JSX.Element => (
  <>
    {locations.map((loc, index) => (
      <Marker
        key={`${loc.name}-${index}`}
        position={loc.coordinates}
        icon={MarkerIcon}
        title={loc.name}
      >
        <Popup>
          <div className="roamjs-marker-data">
            {loc.name}
          </div>
        </Popup>
      </Marker>
    ))}
  </>
);

const getFitBounds = (locations: Location[], routePoints: LatLng[]): LatLngBounds | null => {
  const points = [
    ...locations.map(loc => new LatLng(loc.coordinates[0], loc.coordinates[1])),
    ...routePoints
  ];
  
  if (points.length === 0) return null;
  
  return points.reduce(
    (bounds, point) => bounds.extend(point),
    new LatLngBounds(points[0], points[0])
  );
};

const RouteAndPlacesLayer = ({ tree }: { tree: { children: TreeNode[] } }): JSX.Element | null => {
  const [routePoints, setRoutePoints] = useState<LatLng[]>([]);
  const [routeLocations, setRouteLocations] = useState<Location[]>([]);
  const [places, setPlaces] = useState<Location[]>([]);
  const map = useMap();

  useEffect(() => {
    const loadLocationsAndRoute = async () => {
      // Handle Places
      const placesNode = tree.children.find(c => c.text.trim().toUpperCase() === "PLACES");
      const placesList = placesNode ? await getLocationsFromNodes(placesNode.children) : [];
      setPlaces(placesList);

      // Handle Route
      const routeNode = tree.children.find(c => c.text.trim().toUpperCase() === "ROUTE");
      if (routeNode?.children?.length) {
        const routeLocs = await getLocationsFromNodes(routeNode.children);
        setRouteLocations(routeLocs);
        
        if (routeLocs.length >= 2) {
          const points = await getRouteCoordinates(routeLocs);
          setRoutePoints(points);
        }
      }
    };

    loadLocationsAndRoute();
  }, [tree]);

  // Update map bounds when locations or route change
  useEffect(() => {
    const bounds = getFitBounds([...places, ...routeLocations], routePoints);
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [places, routeLocations, routePoints, map]);

  return (
    <>
      <LocationMarkers locations={[...routeLocations, ...places]} />
      {routePoints.length > 0 && (
        <Polyline
          positions={routePoints}
          color="blue"
          weight={3}
          opacity={0.7}
        />
      )}
    </>
  );
};

export default RouteAndPlacesLayer;