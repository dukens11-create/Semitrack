export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(protected value: T) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  protected publish(value: T) {
    this.value = value;
    this.listeners.forEach(listener => listener());
  }
}
