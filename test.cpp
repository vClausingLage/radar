#include <iostream>
#include <thread>
#include <cmath>
#include <chrono>
#include <vector>

constexpr double SPEED_OF_TRAVEL = 10; // m/s
constexpr int TIME_STEP = 10; // milliseconds

class Vector {
    public: 
        struct Vector3 {
            double x, y, z;

            Vector3(double x = 0, double y = 0, double z = 0) : x(x), y(y), z(z) {}

            // Calculate the distance to another point in 3D space
            double distanceTo(const Vector3& other) const {
                return std::sqrt(
                    (x - other.x) * (x - other.x) +
                    (y - other.y) * (y - other.y) +
                    (z - other.z) * (z - other.z)
                );
            }
        };
};

class Signal {
    public:
        Vector::Vector3 position;
        Vector::Vector3 direction;
        double speed;

        Signal(const Vector::Vector3& pos, const Vector::Vector3& dir, double spd)
            : position(pos), direction(dir), speed(spd) {}

        void move(double time) {
            position.x += direction.x * speed * time;
            position.y += direction.y * speed * time;
            position.z += direction.z * speed * time;
        }
};

class Radar {
    public:
        Vector::Vector3 position;

        Radar(const Vector::Vector3& pos) : position(pos) {}

        Signal transmitAndReceive(const Vector::Vector3& pulseDirection) const {
            Vector::Vector3 direction(
                pulseDirection.x - position.x,
                pulseDirection.y - position.y,
                pulseDirection.z - position.z
            );
            double length = std::sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
            direction.x /= length;
            direction.y /= length;
            direction.z /= length;
            return Signal(position, direction, SPEED_OF_TRAVEL);
        }
};

class Target {
    public:
        Vector::Vector3 position;
        Vector::Vector3 size;

        Target(const Vector::Vector3& pos, const Vector::Vector3& sz) : position(pos), size(sz) {}

        bool isHit(const Vector::Vector3& signalPos) const {
            return (signalPos.x >= position.x && signalPos.x <= position.x + size.x) &&
                (signalPos.y >= position.y && signalPos.y <= position.y + size.y) &&
                (signalPos.z >= position.z && signalPos.z <= position.z + size.z);
        }
};

class Map {
    public:
        Vector::Vector3 center;
        double length, width, height;

        Map(const Vector::Vector3& center, double length, double width, double height)
            : center(center), length(length), width(width), height(height) {}

        bool isWithinBounds(const Vector::Vector3& position) const {
            return (position.x >= center.x - length / 2 && position.x <= center.x + length / 2) &&
                   (position.y >= center.y - width / 2 && position.y <= center.y + width / 2) &&
                   (position.z >= center.z - height / 2 && position.z <= center.z + height / 2);
        }
};

class Search {
    Radar radar;
    Map map;
    Target target;
    Vector::Vector3 pulseDirection;
    public:
        Search(const Radar& radar, const Map map, const Target& target, Vector::Vector3 pulseDirection) : radar(radar), map(map), target(target), pulseDirection(pulseDirection) {}
        
        double time = 0.0;
        double timeStep = 0.1;
        bool hit = false;

        void turnRadarDirection(Vector::Vector3 &pulseDirection) {
            // Rotate the direction 1 degree to the right
            double angle = 1.0 * M_PI / 180.0; // 1 degree in radians
            double newX = pulseDirection.x * std::cos(angle) - pulseDirection.y * std::sin(angle);
            double newY = pulseDirection.x * std::sin(angle) + pulseDirection.y * std::cos(angle);
            pulseDirection.x = newX;
            pulseDirection.y = newY;
            pulseDirection.z = 0;
        }
        
        void search() {
            Signal signal = radar.transmitAndReceive(pulseDirection);
            std::cout << "Pulse direction begin search: (" << pulseDirection.x << ", " << pulseDirection.y << ", " << pulseDirection.z << ")" << std::endl;
            while (map.isWithinBounds(Vector::Vector3(signal.position))) {
                signal.move(timeStep);
                time += timeStep;
            
                std::cout << "Signal position: (" << signal.position.x << ", " << signal.position.y << ", " << signal.position.z << ")" << std::endl;
        
                if (target.isHit(signal.position)) {
                    hit = true;
                    break;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(TIME_STEP));
            }

            if (hit) {
                std::cout << "Signal hit target!" << std::endl;
            } else {
                std::cout << "No target." << std::endl;
            }

            turnRadarDirection(pulseDirection);
            std::cout << "Pulse direction after search: (" << pulseDirection.x << ", " << pulseDirection.y << ", " << pulseDirection.z << ")" << std::endl;
        }
};

int main() {
    // I
    // Map
    Map map(Vector::Vector3(0, 0, 0), 50, 50, 50);

    // II
    // spawn target(s)
    Target target(Vector::Vector3(10, 1, 0), Vector::Vector3(1, 1, 1));
    std::vector<Target> targets;
    targets.push_back(target);
    targets.push_back(Target(Vector::Vector3(15, 5, 0), Vector::Vector3(1, 1, 1)));
    targets.push_back(Target(Vector::Vector3(20, 10, 0), Vector::Vector3(1, 1, 1)));

    // III
    // spawn radar
    Vector::Vector3 radarPos = Vector::Vector3(0, 0, 0);
    // radar config
    Vector::Vector3 pulseDirection = Vector::Vector3(10, 0, 0);

    //! implement search for multiple targets

    Search search = Search(radarPos, map, target, pulseDirection);
    
    search.search();

    return 0;
}