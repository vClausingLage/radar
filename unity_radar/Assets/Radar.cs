using UnityEngine;
using RadarSystem;

public class Radar : MonoBehaviour
{
    public float range = 450f;
    public float sweepDelay = 0.0001f;
    public GameObject pingPrefab;
    private bool isSearching = false;

    void Start()
    {        
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Space) && !isSearching)
        {
            StartCoroutine(Search());
        }
        else if (Input.GetKeyDown(KeyCode.Space) && isSearching)
        {
            isSearching = false;
            StopCoroutine(Search());
        }
    }

    private System.Collections.IEnumerator Search()
    {
        isSearching = true;

        while (isSearching)
        {
            TrackingComputer trackingComputer = new TrackingComputer();
            for (int angle = 0; angle < 360; angle++)
            {
                if (!isSearching) yield break;

                // Calculate the direction of the radar beam
                Vector3 direction = Quaternion.Euler(0, 0, -angle) * Vector3.up;

                // Perform a raycast to simulate the radar beam
                RaycastHit2D hit = Physics2D.Raycast(transform.position, direction, range);

                // Debug line to visualize the radar beam
                GameObject line = new("RadarLine");
                LineRenderer lineRenderer = line.AddComponent<LineRenderer>();
                lineRenderer.startWidth = 0.05f;
                lineRenderer.endWidth = 0.1f;
                lineRenderer.positionCount = 2;
                lineRenderer.SetPosition(0, transform.position);
                lineRenderer.SetPosition(1, hit.collider != null ? (Vector3)hit.point : transform.position + direction * range);
                lineRenderer.material = new Material(Shader.Find("Sprites/Default"));
                lineRenderer.startColor = Color.green;
                lineRenderer.endColor = Color.green;

                // Destroy the line after the sweepDelay to avoid clutter
                Destroy(line, sweepDelay * 5000);

                // If the radar beam hits something, log it
                if (hit.collider != null && hit.collider.gameObject != gameObject)
                {
                    Vector3 hitPoint = hit.point;
                    Debug.Log($"Hit point: {hitPoint} at angle {angle}");
                    // Instantiate the Ping prefab at the hit point
                    GameObject ping = Instantiate(pingPrefab, hitPoint, Quaternion.identity);
                    // Destroy the Ping object after a short period
                    Destroy(ping, 2f);


                }

                // Wait for the next degree
                yield return new WaitForSeconds(sweepDelay);
            }
        }
    }
}
