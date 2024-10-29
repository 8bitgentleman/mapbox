import { useEffect, useState } from "react";
import { Polyline, useMap } from "react-leaflet";
import axios from "axios";
import { LatLng } from "leaflet";
import extractTag from "roamjs-components/util/extractTag";
import { TreeNode } from "roamjs-components/types";

const MAPBOX_TOKEN = "pk.eyJ1IjoiZHZhcmdhczkyNDk1IiwiYSI6ImNraWYycDExbjAxZ3oycHFwcW51YzVkOXQifQ.snYquuD4M5yAor3cyMGtdA";

type RoutePoint = {
  location: string;
  coordinates: [number, number];
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

const getRouteCoordinates = async (points: RoutePoint[]): Promise<LatLng[]> => {
  if (points.length < 2) return [];
  
  // Mapbox expects coordinates in longitude,latitude format
  const coordinates = points.map(p => `${p.coordinates[1]},${p.coordinates[0]}`).join(';');
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

const getRouteFromTree = async ({ children }: { children: TreeNode[] }): Promise<LatLng[]> => {
  const routeNode = children.find(c => c.text.trim().toUpperCase() === "ROUTE");
  if (!routeNode?.children?.length) return [];

  const points: RoutePoint[] = [];
  
  for (const point of routeNode.children) {
    const locationName = extractTag(point.text.trim());
    const coordMatch = point.children?.[0]?.text.match(/([-\d.]+),\s*([-\d.]+)/);
    
    let coords: [number, number] | null;
    if (coordMatch) {
      coords = [parseFloat(coordMatch[1]), parseFloat(coordMatch[2])];
    } else {
      coords = await getCoordinatesForLocation(locationName);
    }
    
    if (coords) {
      points.push({
        location: locationName,
        coordinates: coords
      });
    }
  }

  if (points.length < 2) {
    console.warn('Not enough valid points to create a route');
    return [];
  }

  return getRouteCoordinates(points);
};

const RouteLayer = ({ tree }: { tree: { children: TreeNode[] } }): JSX.Element | null => {
  const [routePoints, setRoutePoints] = useState<LatLng[]>([]);
  const map = useMap();

  useEffect(() => {
    getRouteFromTree(tree).then(points => {
      setRoutePoints(points);
      if (points.length > 0) {
        const bounds = points.reduce((bounds, point) => bounds.extend(point), map.getBounds());
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    });
  }, [tree, map]);

  return routePoints.length > 0 ? (
    <Polyline
      positions={routePoints}
      color="blue"
      weight={3}
      opacity={0.7}
    />
  ) : null;
};

export default RouteLayer;