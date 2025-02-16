#include <iostream>
#include <thread>
#include <cmath>
#include <chrono>
#include <vector>
#include <SFML/Graphics.hpp>

constexpr double SPEED_OF_TRAVEL = 10; // m/s
constexpr int TIME_STEP = 200; // milliseconds

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

        void reflectToRadar(const Vector::Vector3& radarPosition) {
            // Reflect the signal back to the radar
            direction.x = radarPosition.x - position.x;
            direction.y = radarPosition.y - position.y;
            direction.z = radarPosition.z - position.z;
            double length = std::sqrt(
                direction.x * direction.x +
                direction.y * direction.y +
                direction.z * direction.z
            );
            direction.x /= length;
            direction.y /= length;
            direction.z /= length;
        }
};

class Radar {
    public:
        Vector::Vector3 position;
        Vector::Vector3 pulseDirection;

        Radar(const Vector::Vector3& pos) : position(pos) {}

        Signal transmit(const Vector::Vector3& pulseDirection) const {
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

        void turnRadarDirection(Vector::Vector3 &pulseDirection, double angle = 1.0) {
            // Rotate the direction 1 degree to the right
            angle = 5.0 * M_PI / 180.0; // 1 degree in radians
            double newX = pulseDirection.x * std::cos(angle) - pulseDirection.y * std::sin(angle);
            double newY = pulseDirection.x * std::sin(angle) + pulseDirection.y * std::cos(angle);
            pulseDirection.x = newX;
            pulseDirection.y = newY;
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

class Track {

};

class Search {
    Radar radar;
    Map map;
    Target target;
    public:
        Search(const Radar& radar, const Map map, const Target& target) : radar(radar), map(map), target(target) {}
        
        double time = 0.0;
        double timeStep = 0.1;
        bool hit = false;
        
        void search() {
            Signal signal = radar.transmit(radar.pulseDirection);
            std::cout << "Pulse direction begin search: (" << radar.pulseDirection.x << ", " << radar.pulseDirection.y << ", " << radar.pulseDirection.z << ")" << std::endl;
            while (map.isWithinBounds(Vector::Vector3(signal.position))) {
                // time = 0;
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
                //! change doppler effect
                signal.reflectToRadar(radar.position);
                while (map.isWithinBounds(signal.position)) {
                    signal.move(timeStep);
                    std::cout << "Signal returning position: (" << signal.position.x << ", " << signal.position.y << ", " << signal.position.z << ")" << std::endl;
                    if (signal.position.distanceTo(radar.position) < 1.0) {
                        std::cout << "Signal returned to radar!" << std::endl;
                        break;
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(TIME_STEP));
                }
            } else {
                std::cout << "No target." << std::endl;
            }

            radar.turnRadarDirection(radar.pulseDirection);
            std::cout << "Pulse direction after search: (" << radar.pulseDirection.x << ", " << radar.pulseDirection.y << ", " << radar.pulseDirection.z << ")" << std::endl;
            // search();
        }
};

int main() {
    // I
    // Map
    Map map(Vector::Vector3(0, 0, 0), 50, 50, 50);

    // II
    // spawn target(s)
    Target target(Vector::Vector3(7, 0, 0), Vector::Vector3(1, 1, 1));
    //! implement search for multiple targets
    // std::vector<Target> targets;
    // targets.push_back(target);
    // targets.push_back(Target(Vector::Vector3(15, 5, 0), Vector::Vector3(1, 1, 1)));
    // targets.push_back(Target(Vector::Vector3(20, 10, 0), Vector::Vector3(1, 1, 1)));

    // III
    // spawn radar
    Vector::Vector3 radarPos = Vector::Vector3(0, 0, 0);
    Radar radar(radarPos);
    // radar config
    Vector::Vector3 pulseDirection = Vector::Vector3(10, 0, 0);
    radar.pulseDirection = pulseDirection;

    // IV
    // search for targets
    Search search = Search(radar, map, target);
    search.search();

    return 0;
}