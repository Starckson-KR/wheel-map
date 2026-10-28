// 카카오맵 최소 타입 선언. 쓰는 범위가 늘면 여기에 추가한다.
declare namespace kakao.maps {
  function load(callback: () => void): void

  class LatLng {
    constructor(lat: number, lng: number)
    getLat(): number
    getLng(): number
  }

  class LatLngBounds {
    constructor()
    extend(latlng: LatLng): void
    getSouthWest(): LatLng
    getNorthEast(): LatLng
  }

  interface MapOptions {
    center: LatLng
    level?: number
  }

  class Map {
    constructor(container: HTMLElement, options: MapOptions)
    setCenter(latlng: LatLng): void
    getCenter(): LatLng
    panTo(latlng: LatLng): void
    setLevel(level: number): void
    setBounds(bounds: LatLngBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void
    relayout(): void
    getLevel(): number
    getBounds(): LatLngBounds
  }

  interface MarkerOptions {
    position: LatLng
    map?: Map | null
    draggable?: boolean
    title?: string
    zIndex?: number
  }

  class Marker {
    constructor(options: MarkerOptions)
    setMap(map: Map | null): void
    getPosition(): LatLng
    setPosition(position: LatLng): void
  }

  interface CustomOverlayOptions {
    position: LatLng
    content: string | HTMLElement
    map?: Map | null
    xAnchor?: number
    yAnchor?: number
    zIndex?: number
    clickable?: boolean
  }

  class CustomOverlay {
    constructor(options: CustomOverlayOptions)
    setMap(map: Map | null): void
  }

  interface PolylineOptions {
    map?: Map | null
    path: LatLng[]
    strokeWeight?: number
    strokeColor?: string
    strokeOpacity?: number
    strokeStyle?: string
    zIndex?: number
  }

  class Polyline {
    constructor(options: PolylineOptions)
    setMap(map: Map | null): void
  }

  interface PolygonOptions extends PolylineOptions {
    fillColor?: string
    fillOpacity?: number
  }

  class Polygon {
    constructor(options: PolygonOptions)
    setMap(map: Map | null): void
  }

  namespace event {
    interface MapMouseEvent {
      latLng: LatLng
    }
    function addListener(target: Map, type: 'idle', handler: () => void): void
    function addListener(target: Map, type: 'click', handler: (event: MapMouseEvent) => void): void
    function addListener(target: Polyline | Polygon, type: 'click', handler: (event: MapMouseEvent) => void): void
    function addListener(target: Marker, type: 'dragend' | 'click', handler: () => void): void
  }

  namespace services {
    enum Status {
      OK = 'OK',
      ZERO_RESULT = 'ZERO_RESULT',
      ERROR = 'ERROR',
    }

    interface AddressResult {
      x: string
      y: string
      address_name: string
    }

    interface RegionResult {
      region_type: string
      region_3depth_name: string
    }

    class Geocoder {
      coord2RegionCode(x: number, y: number, callback: (result: RegionResult[], status: Status) => void): void
      coord2Address(x: number, y: number, callback: (result: Coord2AddressResult[], status: Status) => void): void
      addressSearch(
        address: string,
        callback: (result: AddressResult[], status: Status) => void,
      ): void
    }

    interface Coord2AddressResult {
      address: { address_name: string } | null
      road_address: { address_name: string } | null
    }

    interface PlaceResult {
      id: string
      place_name: string
      category_name: string
      category_group_name: string
      address_name: string
      road_address_name: string
      x: string
      y: string
    }

    interface PlacesSearchOptions {
      size?: number
      location?: LatLng
    }

    class Places {
      constructor()
      keywordSearch(
        keyword: string,
        callback: (result: PlaceResult[], status: Status) => void,
        options?: PlacesSearchOptions,
      ): void
    }
  }
}

interface Window {
  kakao: typeof kakao
}
